//! netwatch - checks DNS and SMTP availability and sends an SMS through a
//! REST API when a check fails continuously for the configured window.

mod checks;
mod config;
mod sms;
mod state;
mod tls;

use config::Config;
use state::{Action, CheckState};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_CONFIG: &str = "/etc/netwatch/netwatch.toml";

fn timestamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // civil-from-days (Howard Hinnant)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, rem / 3600, rem % 3600 / 60, rem % 60)
}

macro_rules! log {
    ($lvl:expr, $($a:tt)*) => {{
        let line = format!("{} {} {}", timestamp(), $lvl, format!($($a)*));
        println!("{}", line.chars().map(|c| if c.is_ascii() { c } else { '?' }).collect::<String>());
    }};
}

fn hostname() -> String {
    std::fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

fn ascii(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii() && !c.is_ascii_control() { c } else { '?' }).collect()
}

fn fmt_dur(d: Duration) -> String {
    let s = d.as_secs();
    if s >= 3600 { format!("{}h{}m", s / 3600, s % 3600 / 60) } else { format!("{}m{}s", s / 60, s % 60) }
}

/// Runs all checks in parallel; returns (ok?, error text) per check.
fn run_round(cfg: &Config, tls: &tls::TlsHandle) -> Vec<Result<(), String>> {
    let timeout = cfg.check_timeout();
    thread::scope(|s| {
        let hs: Vec<_> = cfg.probes.iter().map(|c| s.spawn(move || checks::run(c, timeout, tls))).collect();
        hs.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("check panicked".into()))).collect()
    })
}

fn usage() -> ! {
    eprintln!("usage: netwatch [--config FILE] [--check-config | --once | --test-sms]");
    std::process::exit(2);
}

fn main() {
    let mut path = DEFAULT_CONFIG.to_string();
    let mut mode = "run";
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--config" | "-c" => path = args.next().unwrap_or_else(|| usage()),
            "--check-config" => mode = "check",
            "--once" => mode = "once",
            "--test-sms" => mode = "sms",
            "--version" => {
                println!("netwatch {}", env!("CARGO_PKG_VERSION"));
                return;
            }
            _ => usage(),
        }
    }
    let cfg = match Config::load(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("config error: {}", e);
            std::process::exit(1);
        }
    };
    if mode == "check" {
        println!("config ok: {} checks, interval {}s, window {}s", cfg.probes.len(), cfg.general.interval_secs, cfg.general.fail_window_secs);
        if cfg.probes.iter().any(|p| p.needs_tls()) {
            match tls::load_ctx(&cfg.general.ca_file) {
                Ok(c) => println!("trust store ok: {} CA certificates from {}", c.count, cfg.general.ca_file),
                Err(e) => {
                    eprintln!("trust store error: {}", e);
                    std::process::exit(1);
                }
            }
        }
        return;
    }
    let host = hostname();
    if mode == "sms" {
        let sms = sms::Sms::new(cfg.sms);
        match sms.send(&format!("[netwatch] {}: test message", host)) {
            Ok(()) => println!("SMS sent"),
            Err(e) => {
                eprintln!("SMS failed: {}", e);
                std::process::exit(1);
            }
        }
        return;
    }
    if mode == "once" {
        let mut bad = 0;
        let tls = tls::Loader::new(&cfg.general.ca_file).get();
        for (c, r) in cfg.probes.iter().zip(run_round(&cfg, &tls)) {
            match r {
                Ok(()) => println!("OK   {}", c.name),
                Err(e) => {
                    bad += 1;
                    println!("FAIL {}: {}", c.name, e)
                }
            }
        }
        std::process::exit(if bad > 0 { 1 } else { 0 });
    }
    daemon(cfg, &host);
}

fn daemon(cfg: Config, host: &str) {
    let stop = Arc::new(AtomicBool::new(false));
    for sig in [signal_hook::consts::SIGTERM, signal_hook::consts::SIGINT] {
        signal_hook::flag::register(sig, Arc::clone(&stop)).expect("signal handler");
    }
    log!("INFO", "netwatch {} started: {} checks, every {}s, alert after {}s of continuous failure", env!("CARGO_PKG_VERSION"), cfg.probes.len(), cfg.general.interval_secs, cfg.general.fail_window_secs);

    let window = cfg.window();
    let repeat = Duration::from_secs(cfg.sms.repeat_secs);
    let notify_recovery = cfg.sms.notify_recovery;
    let mut states: Vec<CheckState> = cfg.probes.iter().map(|_| CheckState::default()).collect();
    let mut last_err: Vec<String> = cfg.probes.iter().map(|_| String::new()).collect();
    let interval = cfg.interval();
    let checks_cfg: Vec<String> = cfg.probes.iter().map(|c| c.name.clone()).collect();
    let sms = sms::Sms::new(cfg.sms.clone());

    let mut last_tls_err = String::new();
    let mut loader = tls::Loader::new(&cfg.general.ca_file);
    let mut next = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        let tls = loader.get();
        if let Err(e) = &tls {
            if cfg.probes.iter().any(|p| p.needs_tls()) && *e != last_tls_err {
                log!("ERROR", "trust store: {}", e);
                last_tls_err = e.clone();
            }
        } else {
            last_tls_err.clear();
        }
        let results = run_round(&cfg, &tls);
        let now = Instant::now();
        for (i, r) in results.into_iter().enumerate() {
            let name = &checks_cfg[i];
            let ok = r.is_ok();
            match &r {
                Ok(()) if !last_err[i].is_empty() => log!("INFO", "check {} ok again", name),
                Err(e) if *e != last_err[i] => log!("WARN", "check {} failed: {}", name, e),
                _ => {}
            }
            last_err[i] = r.err().map(|e| ascii(&e)).unwrap_or_default();
            match states[i].observe(now, ok, window, repeat) {
                Action::None => {}
                Action::Alert { down_for } => {
                    let msg = ascii(&format!("[netwatch] {}: {} DOWN for {} ({})", host, name, fmt_dur(down_for), last_err[i]));
                    match sms.send(&msg) {
                        Ok(()) => {
                            states[i].mark_alerted(now);
                            log!("ALERT", "SMS sent: {}", msg);
                        }
                        Err(e) => log!("ERROR", "SMS failed (will retry): {}", e),
                    }
                }
                Action::Recovered => {
                    log!("INFO", "check {} recovered", name);
                    if notify_recovery {
                        let msg = format!("[netwatch] {}: {} RECOVERED", host, name);
                        if let Err(e) = sms.send(&msg) {
                            log!("ERROR", "recovery SMS failed: {}", e);
                        }
                    }
                }
            }
        }
        next += interval;
        while !stop.load(Ordering::Relaxed) {
            let left = next.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            thread::sleep(left.min(Duration::from_millis(500)));
        }
        if next < Instant::now() {
            next = Instant::now();
        }
    }
    log!("INFO", "netwatch stopped");
}
