//! Service checks: DNS (UDP) and SMTP (TCP). Std-only, no external crates.

use crate::config::{Probe, ProbeSpec, Security};
use crate::tls::{TlsCtx, TlsHandle};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub fn run(probe: &Probe, timeout: Duration, tls: &TlsHandle) -> Result<(), String> {
    match &probe.spec {
        ProbeSpec::Dns { server, query } => check_dns(server, query, timeout),
        ProbeSpec::Smtp { host, port, ehlo, security } => check_smtp(host, *port, ehlo, *security, timeout, tls),
        ProbeSpec::Http { url, expect_status, contains } => check_http(url, expect_status, contains.as_deref(), timeout, tls),
    }
}

fn need_tls(tls: &TlsHandle) -> Result<&std::sync::Arc<TlsCtx>, String> {
    tls.as_ref().map_err(|e| format!("trust store unavailable: {}", e))
}

// ---------------------------------------------------------------- HTTP(S)

/// GET the URL. For https the server certificate chain is validated against
/// the system CA bundle and the host name is verified. Redirects are not
/// followed: the status of the monitored URL itself is what counts.
pub fn check_http(url: &str, expect: &[u16], contains: Option<&str>, timeout: Duration, tls: &TlsHandle) -> Result<(), String> {
    let mut cfg = ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .http_status_as_error(false)
        .max_redirects(0)
        .user_agent(concat!("netwatch/", env!("CARGO_PKG_VERSION")));
    if url.starts_with("https://") {
        let ctx = need_tls(tls)?;
        cfg = cfg.tls_config(ureq::tls::TlsConfig::builder().root_certs(ctx.roots.clone()).build());
    }
    let agent: ureq::Agent = cfg.build().into();
    let mut resp = agent.get(url).call().map_err(|e| format!("{}", e))?;
    let code = resp.status().as_u16();
    let good = if expect.is_empty() { (200..400).contains(&code) } else { expect.contains(&code) };
    if !good {
        return Err(format!("HTTP status {}", code));
    }
    if let Some(needle) = contains {
        let body = resp
            .body_mut()
            .with_config()
            .limit(1 << 20)
            .lossy_utf8(true)
            .read_to_string()
            .map_err(|e| format!("reading body: {}", e))?;
        if !body.contains(needle) {
            return Err(format!("body does not contain '{}'", needle));
        }
    }
    Ok(())
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

/// TCP stream that enforces one overall deadline on every read and write.
struct Dl {
    tcp: TcpStream,
    deadline: Instant,
}

impl Dl {
    fn left(&self) -> io::Result<Duration> {
        let d = self.deadline.saturating_duration_since(Instant::now());
        if d.is_zero() { Err(io::Error::new(io::ErrorKind::TimedOut, "check timed out")) } else { Ok(d) }
    }
}

impl Read for Dl {
    fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
        self.tcp.set_read_timeout(Some(self.left()?))?;
        self.tcp.read(b)
    }
}

impl Write for Dl {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        self.tcp.set_write_timeout(Some(self.left()?))?;
        self.tcp.write(b)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.tcp.flush()
    }
}

type TlsStream = rustls::StreamOwned<rustls::ClientConnection, Dl>;

/// TLS handshake with chain + host name validation against the trust store.
fn start_tls(mut dl: Dl, host: &str, ctx: &TlsCtx) -> Result<TlsStream, String> {
    let name = rustls::pki_types::ServerName::try_from(host.to_string()).map_err(|_| format!("invalid TLS server name '{}'", host))?;
    let mut conn = rustls::ClientConnection::new(ctx.client.clone(), name).map_err(|e| format!("TLS setup: {}", e))?;
    while conn.is_handshaking() {
        conn.complete_io(&mut dl).map_err(|e| format!("TLS handshake with {}: {}", host, e))?;
    }
    Ok(rustls::StreamOwned::new(conn, dl))
}

/// Sends an optional command, then reads one (possibly multi-line) reply.
/// Returns the 3-digit code and the text of all reply lines.
fn dialog<S: Read + Write>(r: &mut BufReader<S>, cmd: Option<&str>) -> Result<(u16, Vec<String>), String> {
    if let Some(c) = cmd {
        r.get_mut().write_all(format!("{}\r\n", c).as_bytes()).map_err(|e| format!("write: {}", e))?;
        r.get_mut().flush().map_err(|e| format!("write: {}", e))?;
    }
    let mut lines = Vec::new();
    loop {
        let mut line = String::new();
        let n = (&mut *r).take(4096).read_line(&mut line).map_err(|e| format!("read: {}", e))?;
        if n == 0 {
            return Err("connection closed by server".into());
        }
        let b = line.as_bytes();
        if b.len() < 4 || !b[..3].iter().all(u8::is_ascii_digit) {
            return Err(format!("malformed SMTP reply '{}'", line.trim_end()));
        }
        lines.push(line[4..].trim_end().to_string());
        if b[3] == b' ' || b[3] == b'\r' || b[3] == b'\n' {
            return Ok((line[..3].parse().unwrap(), lines));
        }
    }
}

fn expect<S: Read + Write>(r: &mut BufReader<S>, cmd: Option<&str>, code: u16, what: &str) -> Result<Vec<String>, String> {
    let (c, lines) = dialog(r, cmd)?;
    if c != code {
        return Err(format!("SMTP {} reply {}", what, c));
    }
    Ok(lines)
}

fn connect(host: &str, port: u16, deadline: Instant) -> Result<TcpStream, String> {
    let addrs: Vec<SocketAddr> = (host, port).to_socket_addrs().map_err(|e| format!("cannot resolve {}: {}", host, e))?.collect();
    let mut last = format!("no address for {}", host);
    for a in addrs {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(format!("connect {}: timed out", host));
        }
        match TcpStream::connect_timeout(&a, left) {
            Ok(s) => return Ok(s),
            Err(e) => last = format!("connect {}: {}", a, e),
        }
    }
    Err(last)
}

/// Greeting, EHLO, QUIT on an established (plain or TLS) stream.
fn session<S: Read + Write>(r: &mut BufReader<S>, ehlo: &str, greeting: bool) -> Result<Vec<String>, String> {
    if greeting {
        expect(r, None, 220, "greeting")?;
    }
    let caps = expect(r, Some(&format!("EHLO {}", ehlo)), 250, "EHLO")?;
    Ok(caps)
}

pub fn check_smtp(host: &str, port: u16, ehlo: &str, security: Security, timeout: Duration, tls: &TlsHandle) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let ctx = if security == Security::None { None } else { Some(need_tls(tls)?) };
    let dl = Dl { tcp: connect(host, port, deadline)?, deadline };
    match security {
        Security::None => {
            let mut r = BufReader::new(dl);
            session(&mut r, ehlo, true)?;
            let _ = r.get_mut().write_all(b"QUIT\r\n");
        }
        Security::Tls => {
            let mut r = BufReader::new(start_tls(dl, host, ctx.unwrap())?);
            session(&mut r, ehlo, true)?;
            let _ = r.get_mut().write_all(b"QUIT\r\n");
        }
        Security::StartTls => {
            let mut r = BufReader::new(dl);
            let caps = session(&mut r, ehlo, true)?;
            if !caps.iter().any(|l| l.eq_ignore_ascii_case("STARTTLS")) {
                return Err("server does not offer STARTTLS".into());
            }
            expect(&mut r, Some("STARTTLS"), 220, "STARTTLS")?;
            if !r.buffer().is_empty() {
                return Err("unexpected data before TLS handshake".into());
            }
            let mut r = BufReader::new(start_tls(r.into_inner(), host, ctx.unwrap())?);
            session(&mut r, ehlo, false)?; // EHLO must be repeated inside TLS
            let _ = r.get_mut().write_all(b"QUIT\r\n");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    const T: Duration = Duration::from_secs(2);

    fn nt() -> TlsHandle {
        Err("no trust store".into())
    }

    fn fake_http(status: &'static str, body: &'static str) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut got = Vec::new();
            let mut b = [0u8; 1024];
            while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = s.read(&mut b).unwrap();
                if n == 0 {
                    break;
                }
                got.extend_from_slice(&b[..n]);
            }
            let r = format!("HTTP/1.1 {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", status, body.len(), body);
            s.write_all(r.as_bytes()).unwrap();
        });
        format!("http://127.0.0.1:{}/health", port)
    }

    #[test]
    fn http_status_rules() {
        assert!(check_http(&fake_http("200 OK", "fine"), &[], None, T, &nt()).is_ok());
        assert!(check_http(&fake_http("302 Found", ""), &[], None, T, &nt()).is_ok());
        assert!(check_http(&fake_http("503 Service Unavailable", ""), &[], None, T, &nt()).is_err());
        assert!(check_http(&fake_http("404 Not Found", ""), &[404], None, T, &nt()).is_ok());
        assert!(check_http(&fake_http("200 OK", ""), &[204], None, T, &nt()).is_err());
    }

    #[test]
    fn http_body_match() {
        assert!(check_http(&fake_http("200 OK", "status: ALL GOOD"), &[], Some("ALL GOOD"), T, &nt()).is_ok());
        assert!(check_http(&fake_http("200 OK", "status: broken"), &[], Some("ALL GOOD"), T, &nt()).is_err());
    }

    #[test]
    fn http_connection_refused() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let p = l.local_addr().unwrap().port();
        drop(l);
        assert!(check_http(&format!("http://127.0.0.1:{}/", p), &[], None, T, &nt()).is_err());
    }

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
        assert!(check_smtp("127.0.0.1", p, "x.test", Security::None, T, &nt()).is_ok());
    }

    #[test]
    fn smtp_bad_greeting() {
        let p = fake_smtp("554 no service\r\n");
        assert!(check_smtp("127.0.0.1", p, "x.test", Security::None, T, &nt()).is_err());
    }

    #[test]
    fn smtp_refused() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let p = l.local_addr().unwrap().port();
        drop(l);
        assert!(check_smtp("127.0.0.1", p, "x.test", Security::None, T, &nt()).is_err());
    }

    // ------------------------------------------------------------ TLS

    use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
    use std::sync::Arc;

    /// Generates a CA and a server certificate for 127.0.0.1 signed by it.
    /// Returns (CA pem, server TLS config).
    fn pki(san: &str, expired: bool) -> (String, Arc<rustls::ServerConfig>) {
        use rcgen::*;
        let ca_key = KeyPair::generate().unwrap();
        let mut cp = CertificateParams::new(Vec::<String>::new()).unwrap();
        cp.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        cp.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        cp.distinguished_name.push(DnType::CommonName, "netwatch test CA");
        let ca = cp.self_signed(&ca_key).unwrap();
        let key = KeyPair::generate().unwrap();
        let mut lp = CertificateParams::new(vec![san.to_string()]).unwrap();
        if expired {
            lp.not_before = date_time_ymd(2000, 1, 1);
            lp.not_after = date_time_ymd(2001, 1, 1);
        }
        let leaf = lp.signed_by(&key, &Issuer::from_params(&cp, &ca_key)).unwrap();
        let cfg = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![CertificateDer::from(leaf.der().to_vec())], PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.serialize_der())))
            .unwrap();
        (ca.pem(), Arc::new(cfg))
    }

    fn trust(ca_pem: &str) -> TlsHandle {
        crate::tls::ctx_from_pem(ca_pem.as_bytes()).map(Arc::new)
    }

    fn read_line_from<R: BufRead>(r: &mut R) -> String {
        let mut l = String::new();
        r.read_line(&mut l).unwrap_or(0);
        l
    }

    /// Fake mail server. mode "tls": implicit TLS; "starttls": plain + upgrade.
    fn tls_smtp(cfg: Arc<rustls::ServerConfig>, mode: &'static str) -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut tcp, _) = l.accept().unwrap();
            let conn = rustls::ServerConnection::new(cfg).unwrap();
            if mode == "starttls" {
                tcp.write_all(b"220 mail.test\r\n").unwrap();
                let mut r = BufReader::new(tcp.try_clone().unwrap());
                read_line_from(&mut r); // EHLO
                tcp.write_all(b"250-mail.test\r\n250 STARTTLS\r\n").unwrap();
                read_line_from(&mut r); // STARTTLS
                tcp.write_all(b"220 go ahead\r\n").unwrap();
            }
            let mut tls = rustls::StreamOwned::new(conn, tcp);
            if mode == "tls" && tls.write_all(b"220 mail.test\r\n").is_err() {
                return;
            }
            let mut r = BufReader::new(tls);
            if read_line_from(&mut r).is_empty() {
                return; // client aborted handshake
            }
            let _ = r.get_mut().write_all(b"250 mail.test\r\n");
            read_line_from(&mut r);
        });
        port
    }

    fn https_server(cfg: Arc<rustls::ServerConfig>) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        thread::spawn(move || {
            let (tcp, _) = l.accept().unwrap();
            let mut r = BufReader::new(rustls::StreamOwned::new(rustls::ServerConnection::new(cfg).unwrap(), tcp));
            loop {
                let l = read_line_from(&mut r);
                if l.is_empty() {
                    return;
                }
                if l == "\r\n" {
                    break;
                }
            }
            let _ = r.get_mut().write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
            let _ = r.get_mut().flush();
        });
        format!("https://127.0.0.1:{}/", port)
    }

    #[test]
    fn smtps_valid_chain() {
        let (ca, cfg) = pki("127.0.0.1", false);
        let p = tls_smtp(cfg, "tls");
        check_smtp("127.0.0.1", p, "x.test", Security::Tls, T, &trust(&ca)).unwrap();
    }

    #[test]
    fn submission_starttls_valid_chain() {
        let (ca, cfg) = pki("127.0.0.1", false);
        let p = tls_smtp(cfg, "starttls");
        check_smtp("127.0.0.1", p, "x.test", Security::StartTls, T, &trust(&ca)).unwrap();
    }

    #[test]
    fn smtp_tls_rejects_untrusted_wrong_name_and_expired() {
        let (_ca, cfg) = pki("127.0.0.1", false);
        let (other_ca, _) = pki("127.0.0.1", false);
        let e = check_smtp("127.0.0.1", tls_smtp(cfg, "tls"), "x", Security::Tls, T, &trust(&other_ca)).unwrap_err();
        assert!(e.contains("UnknownIssuer") || e.contains("BadSignature"), "{}", e);

        let (ca, cfg) = pki("mail.other.test", false);
        let e = check_smtp("127.0.0.1", tls_smtp(cfg, "starttls"), "x", Security::StartTls, T, &trust(&ca)).unwrap_err();
        assert!(e.contains("NotValidForName") || e.contains("not valid for"), "{}", e);

        let (ca, cfg) = pki("127.0.0.1", true);
        let e = check_smtp("127.0.0.1", tls_smtp(cfg, "tls"), "x", Security::Tls, T, &trust(&ca)).unwrap_err();
        assert!(e.to_lowercase().contains("expired"), "{}", e);
    }

    #[test]
    fn starttls_requires_capability_and_trust_store() {
        let p = fake_smtp("220 mail.test\r\n"); // plain server, no STARTTLS in EHLO
        let (ca, _) = pki("127.0.0.1", false);
        let e = check_smtp("127.0.0.1", p, "x", Security::StartTls, T, &trust(&ca)).unwrap_err();
        assert!(e.contains("STARTTLS"), "{}", e);
        assert!(check_smtp("127.0.0.1", 1, "x", Security::Tls, T, &nt()).unwrap_err().contains("trust store"));
    }

    #[test]
    fn https_chain_validation() {
        let (ca, cfg) = pki("127.0.0.1", false);
        check_http(&https_server(cfg), &[], Some("ok"), T, &trust(&ca)).unwrap();

        let (_ca, cfg) = pki("127.0.0.1", false);
        let (other, _) = pki("127.0.0.1", false);
        assert!(check_http(&https_server(cfg), &[], None, T, &trust(&other)).is_err());

        let (ca, cfg) = pki("www.other.test", false);
        assert!(check_http(&https_server(cfg), &[], None, T, &trust(&ca)).is_err());

        let (ca, cfg) = pki("127.0.0.1", true);
        assert!(check_http(&https_server(cfg), &[], None, T, &trust(&ca)).is_err());

        assert!(check_http("https://127.0.0.1:1/", &[], None, T, &nt()).unwrap_err().contains("trust store"));
    }
}
