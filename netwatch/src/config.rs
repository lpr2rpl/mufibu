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
}

impl Default for General {
    fn default() -> Self {
        General {
            interval_secs: d_interval(),
            fail_window_secs: d_window(),
            check_timeout_secs: d_timeout(),
        }
    }
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

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CheckKind {
    Dns {
        /// Resolver to ask, "ip" or "ip:port" (port defaults to 53).
        server: String,
        /// Name that must resolve (A record).
        query: String,
    },
    Smtp {
        host: String,
        #[serde(default = "d_smtp_port")]
        port: u16,
        /// Name used in EHLO.
        #[serde(default = "d_ehlo")]
        ehlo: String,
    },
}

fn d_smtp_port() -> u16 {
    25
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
        let cfg: Config = toml::from_str(&text).map_err(|e| format!("{}: {}", path, e))?;
        cfg.validate()?;
        Ok(cfg)
    }

    pub fn validate(&self) -> Result<(), String> {
        let g = &self.general;
        if g.interval_secs == 0 || g.check_timeout_secs == 0 {
            return Err("interval_secs and check_timeout_secs must be > 0".into());
        }
        if g.fail_window_secs < g.interval_secs * 2 {
            return Err("fail_window_secs must be at least 2 x interval_secs".into());
        }
        if self.checks.is_empty() {
            return Err("at least one [[check]] is required".into());
        }
        let mut names = std::collections::BTreeSet::new();
        for c in &self.checks {
            if c.name.trim().is_empty() || !names.insert(c.name.clone()) {
                return Err(format!("check name '{}' is empty or duplicated", c.name));
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
