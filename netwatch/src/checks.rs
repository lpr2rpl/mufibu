//! Service checks: DNS (UDP) and SMTP (TCP). Std-only, no external crates.

use crate::config::{CheckCfg, CheckKind};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub fn run(cfg: &CheckCfg, timeout: Duration) -> Result<(), String> {
    match &cfg.kind {
        CheckKind::Dns { server, query } => check_dns(server, query, timeout),
        CheckKind::Smtp { host, port, ehlo } => check_smtp(host, *port, ehlo, timeout),
    }
}

// ---------------------------------------------------------------- DNS

pub fn build_dns_query(id: u16, name: &str) -> Result<Vec<u8>, String> {
    let mut p = Vec::with_capacity(32 + name.len());
    p.extend_from_slice(&id.to_be_bytes());
    p.extend_from_slice(&[0x01, 0x00]); // RD
    p.extend_from_slice(&[0, 1, 0, 0, 0, 0, 0, 0]); // QD=1
    for label in name.trim_end_matches('.').split('.') {
        if label.is_empty() || label.len() > 63 || !label.is_ascii() {
            return Err(format!("invalid DNS name '{}'", name));
        }
        p.push(label.len() as u8);
        p.extend_from_slice(label.as_bytes());
    }
    p.push(0);
    p.extend_from_slice(&[0, 1, 0, 1]); // A, IN
    Ok(p)
}

/// Validates a response: matching id, QR set, RCODE 0, at least one answer.
pub fn parse_dns_response(id: u16, buf: &[u8]) -> Result<(), String> {
    if buf.len() < 12 {
        return Err("short DNS response".into());
    }
    if u16::from_be_bytes([buf[0], buf[1]]) != id {
        return Err("DNS id mismatch".into());
    }
    if buf[2] & 0x80 == 0 {
        return Err("not a DNS response".into());
    }
    let rcode = buf[3] & 0x0f;
    if rcode != 0 {
        return Err(format!("DNS rcode {}", rcode));
    }
    if u16::from_be_bytes([buf[6], buf[7]]) == 0 {
        return Err("DNS response without answers".into());
    }
    Ok(())
}

fn resolve(addr: &str, default_port: u16) -> Result<SocketAddr, String> {
    let with_port = if addr.parse::<SocketAddr>().is_ok() || addr.rsplit_once(':').map_or(false, |(_, p)| p.parse::<u16>().is_ok() && !addr.contains("::")) {
        addr.to_string()
    } else if addr.contains(':') {
        format!("[{}]:{}", addr, default_port)
    } else {
        format!("{}:{}", addr, default_port)
    };
    with_port
        .to_socket_addrs()
        .map_err(|e| format!("cannot resolve {}: {}", addr, e))?
        .next()
        .ok_or_else(|| format!("no address for {}", addr))
}

fn rand_id() -> u16 {
    let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(1);
    ((n ^ (n >> 16)) & 0xffff) as u16
}

pub fn check_dns(server: &str, name: &str, timeout: Duration) -> Result<(), String> {
    let addr = resolve(server, 53)?;
    let id = rand_id();
    let query = build_dns_query(id, name)?;
    let bind = if addr.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
    let sock = UdpSocket::bind(bind).map_err(|e| format!("bind: {}", e))?;
    sock.connect(addr).map_err(|e| format!("connect: {}", e))?;
    let deadline = Instant::now() + timeout;
    sock.send(&query).map_err(|e| format!("send: {}", e))?;
    let mut buf = [0u8; 1500];
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(format!("DNS timeout from {}", addr));
        }
        sock.set_read_timeout(Some(left)).map_err(|e| e.to_string())?;
        match sock.recv(&mut buf) {
            Ok(n) => match parse_dns_response(id, &buf[..n]) {
                Err(e) if e == "DNS id mismatch" => continue, // stray packet
                other => return other,
            },
            Err(e) => return Err(format!("DNS recv from {}: {}", addr, e)),
        }
    }
}

// ---------------------------------------------------------------- SMTP

/// Reads one (possibly multi-line) SMTP reply, returns its 3-digit code.
fn read_reply<R: BufRead>(r: &mut R) -> Result<u16, String> {
    loop {
        let mut line = String::new();
        let n = r.read_line(&mut line).map_err(|e| format!("read: {}", e))?;
        if n == 0 {
            return Err("connection closed by server".into());
        }
        let b = line.as_bytes();
        if b.len() < 4 || !b[..3].iter().all(u8::is_ascii_digit) {
            return Err(format!("malformed SMTP reply '{}'", line.trim_end()));
        }
        if b[3] == b' ' || b[3] == b'\r' || b[3] == b'\n' {
            return Ok(line[..3].parse().unwrap());
        }
    }
}

pub fn check_smtp(host: &str, port: u16, ehlo: &str, timeout: Duration) -> Result<(), String> {
    let target = format!("{}:{}", host, port);
    let addr = target
        .to_socket_addrs()
        .map_err(|e| format!("cannot resolve {}: {}", host, e))?
        .next()
        .ok_or_else(|| format!("no address for {}", host))?;
    let deadline = Instant::now() + timeout;
    let stream = TcpStream::connect_timeout(&addr, timeout).map_err(|e| format!("connect {}: {}", addr, e))?;
    let left = deadline.saturating_duration_since(Instant::now()).max(Duration::from_millis(100));
    stream.set_read_timeout(Some(left)).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(left)).map_err(|e| e.to_string())?;
    let mut w = stream.try_clone().map_err(|e| e.to_string())?;
    let mut r = BufReader::new(stream);

    let code = read_reply(&mut r)?;
    if code != 220 {
        return Err(format!("SMTP greeting code {}", code));
    }
    w.write_all(format!("EHLO {}\r\n", ehlo).as_bytes()).map_err(|e| format!("write: {}", e))?;
    let code = read_reply(&mut r)?;
    if code != 250 {
        return Err(format!("SMTP EHLO code {}", code));
    }
    let _ = w.write_all(b"QUIT\r\n");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    const T: Duration = Duration::from_secs(2);

    #[test]
    fn dns_query_layout() {
        let q = build_dns_query(0x1234, "a.example.com.").unwrap();
        assert_eq!(&q[..2], &[0x12, 0x34]);
        assert_eq!(&q[12..], b"\x01a\x07example\x03com\x00\x00\x01\x00\x01");
        assert!(build_dns_query(1, "bad..name").is_err());
    }

    #[test]
    fn dns_response_rules() {
        let mut ok = vec![0x00, 0x07, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
        assert!(parse_dns_response(7, &ok).is_ok());
        assert!(parse_dns_response(8, &ok).is_err());
        ok[3] = 0x83; // NXDOMAIN
        assert!(parse_dns_response(7, &ok).is_err());
        let noans = vec![0x00, 0x07, 0x81, 0x80, 0, 1, 0, 0, 0, 0, 0, 0];
        assert!(parse_dns_response(7, &noans).is_err());
    }

    #[test]
    fn dns_against_fake_server() {
        let srv = UdpSocket::bind("127.0.0.1:0").unwrap();
        let addr = srv.local_addr().unwrap();
        thread::spawn(move || {
            let mut b = [0u8; 512];
            let (n, from) = srv.recv_from(&mut b).unwrap();
            let mut resp = b[..n].to_vec();
            resp[2] = 0x81;
            resp[3] = 0x80;
            resp[7] = 1;
            srv.send_to(&resp, from).unwrap();
        });
        assert!(check_dns(&addr.to_string(), "example.com", T).is_ok());
    }

    #[test]
    fn dns_timeout() {
        let srv = UdpSocket::bind("127.0.0.1:0").unwrap();
        let addr = srv.local_addr().unwrap();
        assert!(check_dns(&addr.to_string(), "example.com", Duration::from_millis(300)).is_err());
    }

    fn fake_smtp(greeting: &'static str) -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            s.write_all(greeting.as_bytes()).unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut line = String::new();
            if r.read_line(&mut line).unwrap_or(0) > 0 {
                s.write_all(b"250-mail.test\r\n250 PIPELINING\r\n").ok();
            }
        });
        port
    }

    #[test]
    fn smtp_ok() {
        let p = fake_smtp("220 mail.test ESMTP\r\n");
        assert!(check_smtp("127.0.0.1", p, "x.test", T).is_ok());
    }

    #[test]
    fn smtp_bad_greeting() {
        let p = fake_smtp("554 no service\r\n");
        assert!(check_smtp("127.0.0.1", p, "x.test", T).is_err());
    }

    #[test]
    fn smtp_refused() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let p = l.local_addr().unwrap().port();
        drop(l);
        assert!(check_smtp("127.0.0.1", p, "x.test", T).is_err());
    }
}
