//! Configuration file handling (TOML).

use serde::Deserialize;
use std::collections::BTreeMap;
use std::fs;
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub general: General,
    #[serde(default, rename = "check")]
    pub checks: Vec<CheckCfg>,
    pub sms: SmsCfg,
    /// Expanded checks (one per target); filled by `load`.
    #[serde(skip)]
    pub probes: Vec<Probe>,
}

#[derive(Debug, Deserialize)]
pub struct General {
    /// Seconds between two check rounds.
    #[serde(default = "d_interval")]
    pub interval_secs: u64,
    /// A check must fail continuously for this long before an SMS is sent.
    #[serde(default = "d_window")]
    pub fail_window_secs: u64,
    /// Timeout of a single check.
    #[serde(default = "d_timeout")]
    pub check_timeout_secs: u64,
    /// CA bundle used to validate server certificate chains (https, smtps,
    /// starttls). Devuan: provided by the ca-certificates package.
    #[serde(default = "d_ca")]
    pub ca_file: String,
}

impl Default for General {
    fn default() -> Self {
        General {
            interval_secs: d_interval(),
            fail_window_secs: d_window(),
            check_timeout_secs: d_timeout(),
            ca_file: d_ca(),
        }
    }
}

fn d_ca() -> String {
    crate::tls::DEFAULT_CA_FILE.to_string()
}
fn d_interval() -> u64 {
    15
}
fn d_window() -> u64 {
    120
}
fn d_timeout() -> u64 {
    5
}

/// Raw `[[check]]` entry. A check may name one target (`server`, `host`,
/// `url`) or a list of targets (`servers`, `hosts`, `urls`); every target is
/// monitored and alerted on separately.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CheckKind {
    Dns {
        /// Resolver, "ip" or "ip:port" (port defaults to 53).
        server: Option<String>,
        #[serde(default)]
        servers: Vec<String>,
        /// Name that must resolve (A record).
        query: String,
    },
    Smtp {
        host: Option<String>,
        #[serde(default)]
        hosts: Vec<String>,
        /// Default: 25 (none), 587 (starttls), 465 (tls).
        port: Option<u16>,
        /// "none" (plain), "starttls" (alias "submission": STARTTLS upgrade,
        /// usually port 587) or "tls" (alias "smtps": implicit TLS, port 465).
        /// With TLS the certificate chain and host name are verified.
        #[serde(default)]
        security: Security,
        /// Name used in EHLO.
        #[serde(default = "d_ehlo")]
        ehlo: String,
    },
    Http {
        url: Option<String>,
        #[serde(default)]
        urls: Vec<String>,
        /// Accepted status codes; empty = any 2xx or 3xx (redirects are not followed).
        #[serde(default)]
        expect_status: Vec<u16>,
        /// Response body (first 1 MiB) must contain this text.
        contains: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    #[default]
    None,
    #[serde(alias = "submission")]
    StartTls,
    #[serde(alias = "smtps")]
    Tls,
}

impl Security {
    pub fn default_port(self) -> u16 {
        match self {
            Security::None => 25,
            Security::StartTls => 587,
            Security::Tls => 465,
        }
    }
}

fn d_ehlo() -> String {
    "netwatch.localdomain".to_string()
}

#[derive(Debug, Deserialize)]
pub struct CheckCfg {
    pub name: String,
    #[serde(flatten)]
    pub kind: CheckKind,
}

/// One concrete thing to probe, produced from a `CheckCfg`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub name: String,
    pub spec: ProbeSpec,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeSpec {
    Dns { server: String, query: String },
    Smtp { host: String, port: u16, ehlo: String, security: Security },
    Http { url: String, expect_status: Vec<u16>, contains: Option<String> },
}

fn targets(single: &Option<String>, list: &[String], what: &str, name: &str) -> Result<Vec<String>, String> {
    let all: Vec<String> = single.iter().chain(list.iter()).map(|t| t.trim().to_string()).collect();
    if all.is_empty() || all.iter().any(|t| t.is_empty()) {
        return Err(format!("check '{}': needs '{}' or a non-empty list", name, what));
    }
    Ok(all)
}

impl Probe {
    /// True if the probe validates a certificate chain.
    pub fn needs_tls(&self) -> bool {
        match &self.spec {
            ProbeSpec::Dns { .. } => false,
            ProbeSpec::Smtp { security, .. } => *security != Security::None,
            ProbeSpec::Http { url, .. } => url.starts_with("https://"),
        }
    }
}

impl CheckCfg {
    pub fn expand(&self) -> Result<Vec<Probe>, String> {
        let n = &self.name;
        let label = |t: &str, many: bool| if many { format!("{} {}", n, t) } else { n.clone() };
        let mut out = Vec::new();
        match &self.kind {
            CheckKind::Dns { server, servers, query } => {
                let t = targets(server, servers, "server", n)?;
                for x in &t {
                    out.push(Probe { name: label(x, t.len() > 1), spec: ProbeSpec::Dns { server: x.clone(), query: query.clone() } });
                }
            }
            CheckKind::Smtp { host, hosts, port, ehlo, security } => {
                let t = targets(host, hosts, "host", n)?;
                for x in &t {
                    // "host" or "host:port" per target; plain host uses `port`.
                    let (h, p) = match x.rsplit_once(':') {
                        Some((h, p)) if !h.contains(':') && p.parse::<u16>().is_ok() => (h.to_string(), p.parse().unwrap()),
                        _ => (x.clone(), port.unwrap_or_else(|| security.default_port())),
                    };
                    out.push(Probe { name: label(x, t.len() > 1), spec: ProbeSpec::Smtp { host: h, port: p, ehlo: ehlo.clone(), security: *security } });
                }
            }
            CheckKind::Http { url, urls, expect_status, contains } => {
                let t = targets(url, urls, "url", n)?;
                for x in &t {
                    if !x.starts_with("http://") && !x.starts_with("https://") {
                        return Err(format!("check '{}': url '{}' must start with http:// or https://", n, x));
                    }
                    out.push(Probe {
                        name: label(x, t.len() > 1),
                        spec: ProbeSpec::Http { url: x.clone(), expect_status: expect_status.clone(), contains: contains.clone() },
                    });
                }
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SmsCfg {
    /// REST endpoint, e.g. https://api.example.com/v1/sms
    pub url: String,
    /// Phone numbers in international format.
    pub recipients: Vec<String>,
    /// "json" or "form".
    #[serde(default = "d_format")]
    pub body_format: String,
    /// Request body; {to} and {message} are replaced (and escaped).
    #[serde(default = "d_body")]
    pub body_template: String,
    /// Extra HTTP headers.
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// File holding a bearer token (recommended; keep it mode 0640).
    pub token_file: Option<String>,
    /// Alternative: token directly in the config (less safe).
    pub token: Option<String>,
    #[serde(default = "d_sms_timeout")]
    pub timeout_secs: u64,
    /// Repeat the alert SMS every N seconds while still down (0 = never).
    #[serde(default)]
    pub repeat_secs: u64,
    /// Send an SMS when a check recovers.
    #[serde(default = "d_true")]
    pub notify_recovery: bool,
}

fn d_format() -> String {
    "json".to_string()
}
fn d_body() -> String {
    r#"{"to":"{to}","message":"{message}"}"#.to_string()
}
fn d_sms_timeout() -> u64 {
    15
}
fn d_true() -> bool {
    true
}

impl Config {
    pub fn load(path: &str) -> Result<Config, String> {
        let text = fs::read_to_string(path).map_err(|e| format!("cannot read {}: {}", path, e))?;
        Config::parse(&text).map_err(|e| format!("{}: {}", path, e))
    }

    pub fn parse(text: &str) -> Result<Config, String> {
        let mut cfg: Config = toml::from_str(text).map_err(|e| e.to_string())?;
        cfg.probes = cfg.checks.iter().map(CheckCfg::expand).collect::<Result<Vec<_>, _>>()?.concat();
        cfg.validate()?;
        Ok(cfg)
    }

    fn validate(&self) -> Result<(), String> {
        let g = &self.general;
        if g.interval_secs == 0 || g.check_timeout_secs == 0 {
            return Err("interval_secs and check_timeout_secs must be > 0".into());
        }
        if g.fail_window_secs < g.interval_secs * 2 {
            return Err("fail_window_secs must be at least 2 x interval_secs".into());
        }
        if self.checks.is_empty() || self.probes.is_empty() {
            return Err("at least one [[check]] is required".into());
        }
        let mut names = std::collections::BTreeSet::new();
        for p in &self.probes {
            if p.name.trim().is_empty() || !names.insert(p.name.clone()) {
                return Err(format!("check name '{}' is empty or duplicated", p.name));
            }
        }
        if self.sms.recipients.is_empty() {
            return Err("sms.recipients must not be empty".into());
        }
        if !matches!(self.sms.body_format.as_str(), "json" | "form") {
            return Err("sms.body_format must be 'json' or 'form'".into());
        }
        if !self.sms.url.starts_with("http://") && !self.sms.url.starts_with("https://") {
            return Err("sms.url must start with http:// or https://".into());
        }
        Ok(())
    }

    pub fn interval(&self) -> Duration {
        Duration::from_secs(self.general.interval_secs)
    }
    pub fn window(&self) -> Duration {
        Duration::from_secs(self.general.fail_window_secs)
    }
    pub fn check_timeout(&self) -> Duration {
        Duration::from_secs(self.general.check_timeout_secs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SMS: &str = "[sms]\nurl='https://x/'\nrecipients=['+1']\n";

    #[test]
    fn expands_lists_and_single_targets() {
        let c = Config::parse(&format!(
            "[[check]]\nname='dns'\nkind='dns'\nservers=['10.0.0.1','10.0.0.2:5353']\nquery='a.b'\n\
             [[check]]\nname='mx'\nkind='smtp'\nhosts=['m1.x','m2.x:587']\nport=25\n\
             [[check]]\nname='web'\nkind='http'\nurl='https://x.y/'\nexpect_status=[200]\n{}",
            SMS
        ))
        .unwrap();
        let names: Vec<_> = c.probes.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["dns 10.0.0.1", "dns 10.0.0.2:5353", "mx m1.x", "mx m2.x:587", "web"]);
        assert_eq!(c.probes[2].spec, ProbeSpec::Smtp { host: "m1.x".into(), port: 25, ehlo: "netwatch.localdomain".into(), security: Security::None });
        assert!(matches!(&c.probes[3].spec, ProbeSpec::Smtp { port: 587, .. }));
    }

    #[test]
    fn smtp_security_defaults() {
        let c = Config::parse(&format!(
            "[[check]]\nname='s'\nkind='smtp'\nhost='a'\nsecurity='smtps'\n\
             [[check]]\nname='m'\nkind='smtp'\nhost='b'\nsecurity='submission'\n\
             [[check]]\nname='x'\nkind='smtp'\nhost='c'\nsecurity='starttls'\nport=2525\n{}",
            SMS
        ))
        .unwrap();
        let ports: Vec<_> = c.probes.iter().map(|p| match &p.spec { ProbeSpec::Smtp { port, security, .. } => (*port, *security), _ => unreachable!() }).collect();
        assert_eq!(ports, [(465, Security::Tls), (587, Security::StartTls), (2525, Security::StartTls)]);
        assert!(c.probes.iter().all(|p| p.needs_tls()));
        assert!(Config::parse(&format!("[[check]]\nname='s'\nkind='smtp'\nhost='a'\nsecurity='bogus'\n{}", SMS)).is_err());
    }

    #[test]
    fn rejects_bad_input() {
        let bad = |body: &str| Config::parse(&format!("{}{}", body, SMS)).is_err();
        assert!(bad("[[check]]\nname='a'\nkind='http'\n")); // no url
        assert!(bad("[[check]]\nname='a'\nkind='http'\nurl='ftp://x'\n"));
        assert!(bad("[[check]]\nname='a'\nkind='dns'\nquery='x'\nservers=[]\n"));
        assert!(bad("[[check]]\nname='a'\nkind='smtp'\nhost='h'\n[[check]]\nname='a'\nkind='smtp'\nhost='h'\n"));
    }
}
