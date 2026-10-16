//! SMS delivery through a generic REST API.

use crate::config::SmsCfg;
use std::fs;
use std::time::Duration;

pub struct Sms {
    cfg: SmsCfg,
    agent: ureq::Agent,
}

fn json_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o
}

fn form_escape(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            _ => o.push_str(&format!("%{:02X}", b)),
        }
    }
    o
}

pub fn render_body(cfg: &SmsCfg, to: &str, message: &str) -> String {
    let esc: fn(&str) -> String = if cfg.body_format == "json" { json_escape } else { form_escape };
    cfg.body_template.replace("{to}", &esc(to)).replace("{message}", &esc(message))
}

impl Sms {
    pub fn new(cfg: SmsCfg) -> Sms {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(cfg.timeout_secs)))
            .build()
            .into();
        Sms { cfg, agent }
    }

    fn token(&self) -> Result<Option<String>, String> {
        if let Some(f) = &self.cfg.token_file {
            let t = fs::read_to_string(f).map_err(|e| format!("token_file {}: {}", f, e))?;
            return Ok(Some(t.trim().to_string()));
        }
        Ok(self.cfg.token.clone())
    }

    fn send_one(&self, to: &str, message: &str) -> Result<(), String> {
        let body = render_body(&self.cfg, to, message);
        let ctype = if self.cfg.body_format == "json" { "application/json" } else { "application/x-www-form-urlencoded" };
        let mut req = self.agent.post(&self.cfg.url).header("Content-Type", ctype);
        if let Some(t) = self.token()? {
            req = req.header("Authorization", &format!("Bearer {}", t));
        }
        for (k, v) in &self.cfg.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        match req.send(body.as_bytes()) {
            Ok(r) if r.status().is_success() => Ok(()),
            Ok(r) => Err(format!("HTTP {}", r.status().as_u16())),
            Err(ureq::Error::StatusCode(c)) => Err(format!("HTTP {}", c)),
            Err(e) => Err(format!("{}", e)),
        }
    }

    /// Sends to all recipients; Ok if at least one delivery succeeded.
    pub fn send(&self, message: &str) -> Result<(), String> {
        let mut errors = Vec::new();
        let mut okc = 0;
        for to in &self.cfg.recipients {
            match self.send_one(to, message) {
                Ok(()) => okc += 1,
                Err(e) => errors.push(format!("{}: {}", to, e)),
            }
        }
        if okc > 0 { Ok(()) } else { Err(errors.join("; ")) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn cfg(url: &str, fmt: &str, tpl: &str) -> SmsCfg {
        SmsCfg {
            url: url.into(),
            recipients: vec!["+41790000000".into()],
            body_format: fmt.into(),
            body_template: tpl.into(),
            headers: BTreeMap::new(),
            token_file: None,
            token: Some("s3cret".into()),
            timeout_secs: 3,
            repeat_secs: 0,
            notify_recovery: true,
        }
    }

    #[test]
    fn escaping() {
        let c = cfg("http://x", "json", r#"{"to":"{to}","message":"{message}"}"#);
        assert_eq!(render_body(&c, "+41", "a\"b\\c"), r#"{"to":"+41","message":"a\"b\\c"}"#);
        let f = cfg("http://x", "form", "to={to}&text={message}");
        assert_eq!(render_body(&f, "+41", "a b&c"), "to=%2B41&text=a%20b%26c");
    }

    #[test]
    fn posts_to_rest_api() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut got = Vec::new();
            let mut buf = [0u8; 4096];
            while !got.ends_with(b"}") {
                let n = s.read(&mut buf).unwrap();
                assert!(n > 0);
                got.extend_from_slice(&buf[..n]);
            }
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").unwrap();
            String::from_utf8_lossy(&got).to_string()
        });
        let sms = Sms::new(cfg(&format!("http://127.0.0.1:{}/v1/sms", port), "json", r#"{"to":"{to}","message":"{message}"}"#));
        sms.send("hello").unwrap();
        let req = h.join().unwrap().to_lowercase();
        assert!(req.starts_with("post /v1/sms"));
        assert!(req.contains("authorization: bearer s3cret"));
        assert!(req.contains(r#"{"to":"+41790000000","message":"hello"}"#));
    }

    #[test]
    fn http_error_is_failure() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = s.read(&mut buf);
            s.write_all(b"HTTP/1.1 500 X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let sms = Sms::new(cfg(&format!("http://127.0.0.1:{}/", port), "json", "{}"));
        assert!(sms.send("x").is_err());
    }
}
