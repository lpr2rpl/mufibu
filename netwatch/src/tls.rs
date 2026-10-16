//! Trust store handling: certificate chains are validated against the CA
//! bundle of the operating system (Devuan: package ca-certificates,
//! /etc/ssl/certs/ca-certificates.crt). Host names are always verified.

use std::fs;
use std::sync::Arc;
use std::time::SystemTime;
use ureq::tls::{PemItem, RootCerts, parse_pem};

pub const DEFAULT_CA_FILE: &str = "/etc/ssl/certs/ca-certificates.crt";

pub struct TlsCtx {
    /// For HTTPS (ureq).
    pub roots: RootCerts,
    /// For SMTPS / STARTTLS (rustls directly).
    pub client: Arc<rustls::ClientConfig>,
    pub count: usize,
}

pub type TlsHandle = Result<Arc<TlsCtx>, String>;

pub fn ctx_from_pem(pem: &[u8]) -> Result<TlsCtx, String> {
    let certs: Vec<_> = parse_pem(pem)
        .filter_map(|i| match i {
            Ok(PemItem::Certificate(c)) => Some(c),
            _ => None,
        })
        .collect();
    let mut store = rustls::RootCertStore::empty();
    let (added, _ignored) = store.add_parsable_certificates(certs.iter().map(|c| rustls::pki_types::CertificateDer::from(c.der())));
    if added == 0 {
        return Err("no usable CA certificates found".into());
    }
    let client = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS setup: {}", e))?
        .with_root_certificates(store)
        .with_no_client_auth();
    Ok(TlsCtx { roots: RootCerts::new_with_certs(&certs), client: Arc::new(client), count: added })
}

pub fn load_ctx(path: &str) -> Result<TlsCtx, String> {
    let pem = fs::read(path).map_err(|e| format!("cannot read CA file {}: {}", path, e))?;
    ctx_from_pem(&pem).map_err(|e| format!("{}: {}", path, e))
}

/// Caches the trust store and reloads it when the CA file changes, so that
/// `update-ca-certificates` takes effect without restarting the daemon.
pub struct Loader {
    path: String,
    stamp: Option<(SystemTime, u64)>,
    primed: bool,
    cur: TlsHandle,
}

impl Loader {
    pub fn new(path: &str) -> Loader {
        Loader { path: path.to_string(), stamp: None, primed: false, cur: Err("not loaded".into()) }
    }

    pub fn get(&mut self) -> TlsHandle {
        let stamp = fs::metadata(&self.path).ok().and_then(|m| m.modified().ok().map(|t| (t, m.len())));
        if !self.primed || stamp != self.stamp {
            self.cur = load_ctx(&self.path).map(Arc::new);
            self.stamp = stamp;
            self.primed = true;
        }
        self.cur.clone()
    }
}
