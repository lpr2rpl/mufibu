netwatch - DNS/SMTP availability monitor with SMS alerting
==========================================================

Runs as a small daemon on a remote Devuan (SysVinit) server. Every
`interval_secs` it checks any number of targets of these kinds:

* DNS:  sends an A query over UDP to a resolver; OK = matching reply, RCODE 0,
        at least one answer.
* SMTP: connects via TCP, expects "220" greeting, sends EHLO, expects "250",
        sends QUIT.
* HTTP/HTTPS: GET on a URL. OK = status 2xx/3xx (or one of `expect_status`),
        optionally the body must contain `contains`. TLS certificates are
        verified. Redirects are not followed.

Multiple targets: each `[[check]]` takes `server`/`servers` (dns),
`host`/`hosts` (smtp, optional `host:port`) or `url`/`urls` (http). Every
target is its own check with its own failure timer and its own SMS, named
"<name> <target>". See packaging/etc/netwatch.toml for an example.

If one check fails in every round for `fail_window_secs` (default 120 s), an
SMS is sent by POSTing to a REST API (once per outage; optional repeat and a
recovery SMS). If the API call fails, it is retried every round.

Build
-----
    make test              # unit tests
    make build             # target/release/netwatch
    make deb               # dist/netwatch_<ver>_<arch>.deb
    make deb TARGET=aarch64-unknown-linux-gnu   # cross build (toolchain needed)

Install (Devuan)
----------------
    dpkg -i dist/netwatch_0.1.0_amd64.deb
    editor /etc/netwatch/netwatch.toml
    echo 'YOUR-API-TOKEN' > /etc/netwatch/sms.token
    netwatch --check-config
    netwatch --once            # run all checks one time
    netwatch --test-sms        # send a test SMS
    /etc/init.d/netwatch start

The package creates the system user `netwatch`, registers the init script
(update-rc.d), rotates /var/log/netwatch.log weekly. Config and token are
readable only by root and group netwatch.

SMS REST API
------------
Generic: POST to `sms.url`, header `Authorization: Bearer <token>`, body from
`body_template` ({to}, {message} are escaped for `json` or `form`). Any 2xx
is success. Extra headers go to `[sms.headers]`. Adapt `body_template` to
your provider's field names. Use an https:// URL in production (rustls,
bundled CA roots; no system CA package needed).

Notes
-----
* SMTP check tests the plain port (25/587); implicit TLS (465) is not covered.
* Run the monitor on a host that is independent of the monitored services.
* Output is ASCII only (SMS-safe).
* Files: src/ (code), packaging/ (init script, config, logrotate, maintainer
  scripts), scripts/build-deb.sh, Makefile.
