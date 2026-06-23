#!/bin/sh
# =============================================================================
# MuFiBu Setup Script for Devuan (SysVInit)
# =============================================================================
# Usage: setup.sh [OPTIONS] [STEP...]
#
# Steps (may be combined, run in order):
#   deps       Install system packages + Node.js 20
#   postgres   Create DB user/database; start PostgreSQL
#   schema     Apply schema.sql and all migrations in database/migrations
#   venv       Create Python virtualenv + install dependencies
#   config     Write backend environment file
#   frontend   npm install + build + deploy to web root
#   nginx      Install and reload nginx configuration
#   service    Install and start mufibu-backend SysVInit service
#   all        Run all steps in order (default when no step given)
#   status     Show current installation status and exit
#
# Options:
#   -c FILE    Use FILE as configuration override (KEY=VALUE pairs)
#   -d DIR     Application source directory (default: directory of this script)
#   -n         Dry-run: print commands instead of executing them
#   -f         Force: skip "already done" checks and re-run step
#   -q         Quiet: suppress informational output
#   -v         Verbose: print each command before executing
#   -h         Show this help and exit
#
# Examples:
#   ./setup.sh                          # run all steps
#   ./setup.sh schema                   # re-apply migrations only
#   ./setup.sh frontend nginx           # rebuild frontend and reload nginx
#   ./setup.sh -n all                   # preview every step (dry-run)
#   ./setup.sh status                   # check installation state
#   ./setup.sh -f venv                  # force-recreate virtualenv
# =============================================================================

set -e

# ---------------------------------------------------------------------------
# Defaults (may be overridden by -c FILE)
# ---------------------------------------------------------------------------
DB_NAME=mufibu
DB_USER=mufibu
DB_PASS=mufibu_db_password          # CHANGE THIS in production
APP_INSTALL_DIR=/opt/mufibu
WEB_ROOT=/var/www/mufibu/frontend
LOG_DIR=/var/log/mufibu
RUN_DIR=/var/run/mufibu
CONF_DIR=/etc/mufibu
TLS_DIR=/etc/mufibu/tls
TLS_CN=mufibu.local                 # CN for the generated self-signed cert
SEED_ADMIN_USERNAME=poweradmin
SEED_ADMIN_EMAIL=poweradmin@mufibu.local
SEED_ADMIN_PASSWORD=ChangeMe1!      # Replaced with random value if unchanged
SHOW_SEED_PASSWORD=0                # Set to 1 only for non-production installs
JWT_ACCESS_MINUTES=60
JWT_REFRESH_DAYS=7
CORS_ORIGINS='["http://localhost","http://localhost:80"]'

# ---------------------------------------------------------------------------
# Runtime flags
# ---------------------------------------------------------------------------
DRY_RUN=0
FORCE=0
QUIET=0
VERBOSE=0
CONFIG_FILE=""
STEPS=""

# Resolved at runtime
SCRIPT_DIR=""
SRC_DIR=""

# ---------------------------------------------------------------------------
# Terminal colour helpers (disabled when not a tty)
# ---------------------------------------------------------------------------
_setup_colors() {
    if [ -t 1 ]; then
        RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'
        BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
    else
        RED=''; YELLOW=''; GREEN=''; BLUE=''; BOLD=''; RESET=''
    fi
}

info()  { [ "$QUIET" -eq 0 ] && printf "${BLUE}[INFO]${RESET}  %s\n" "$*"; }
ok()    { [ "$QUIET" -eq 0 ] && printf "${GREEN}[OK]${RESET}    %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${RESET}  %s\n" "$*"; }
die()   { printf "${RED}[ERROR]${RESET} %s\n" "$*" >&2; exit 1; }
step()  { printf "\n${BOLD}==> %s${RESET}\n" "$*"; }
detail(){ [ "$VERBOSE" -eq 1 ] && printf "    %s\n" "$*"; }

# ---------------------------------------------------------------------------
# Command runner (respects --dry-run and --verbose)
# ---------------------------------------------------------------------------
runcmd() {
    detail "$ $*"
    if [ "$DRY_RUN" -eq 1 ]; then
        printf "${YELLOW}[DRY]${RESET}   %s\n" "$*"
        return 0
    fi
    "$@"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            -h|--help)   usage; exit 0 ;;
            -n|--dry-run) DRY_RUN=1 ;;
            -f|--force)  FORCE=1 ;;
            -q|--quiet)  QUIET=1 ;;
            -v|--verbose) VERBOSE=1 ;;
            -c)          shift; CONFIG_FILE="$1" ;;
            -d)          shift; SRC_DIR="$1" ;;
            -*)          die "Unknown option: $1  (try -h for help)" ;;
            *)           STEPS="$STEPS $1" ;;
        esac
        shift
    done

    # Derive source directory from script location
    if [ -z "$SRC_DIR" ]; then
        SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
        SRC_DIR="$SCRIPT_DIR"
    fi

    # Default to 'all' when no step given
    STEPS="${STEPS:-all}"

    # Expand 'all'
    if echo "$STEPS" | grep -qw 'all'; then
        STEPS="deps postgres schema venv config frontend nginx service"
    fi
}

usage() {
    sed -n '/^# Usage:/,/^# ====/p' "$0" | sed 's/^# \?//'
}

# ---------------------------------------------------------------------------
# Load optional config override file
# ---------------------------------------------------------------------------
load_config() {
    [ -z "$CONFIG_FILE" ] && return 0
    [ -r "$CONFIG_FILE" ] || die "Config file not readable: $CONFIG_FILE"
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
    info "Loaded config from $CONFIG_FILE"
}

# ---------------------------------------------------------------------------
# Derive JWT secret (stable within one run, or from config file)
# ---------------------------------------------------------------------------
resolve_jwt_secret() {
    if [ -z "${JWT_SECRET_KEY:-}" ]; then
        JWT_SECRET_KEY="replace-with-a-long-random-string-$(head -c 32 /dev/urandom | base64 | tr -d '/+=\n')"
    fi
}

resolve_seed_admin_password() {
    if [ "${SEED_ADMIN_PASSWORD:-}" = "ChangeMe1!" ]; then
        SEED_ADMIN_PASSWORD="initial-$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n')"
        warn "Generated a random initial PowerAdmin password because the default was unchanged."
    fi
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
require_root() {
    [ "$(id -u)" -eq 0 ] || die "This script must be run as root (or with sudo)."
}

# ---------------------------------------------------------------------------
# STEP: deps
# ---------------------------------------------------------------------------
step_deps() {
    step "Installing system packages"

    # --- Check ---
    if [ "$FORCE" -eq 0 ] && command -v gunicorn >/dev/null 2>&1; then
        info "System packages appear to be installed (gunicorn found). Skipping (use -f to force)."
        return 0
    fi

    runcmd apt-get update -qq

    runcmd apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg lsb-release \
        build-essential libssl-dev libffi-dev libpq-dev \
        python3 python3-pip python3-venv python3-dev \
        postgresql postgresql-client \
        nginx git openssl procps

    # Node.js 20
    NODE_MAJOR=20
    _need_node=1
    if command -v node >/dev/null 2>&1; then
        _ver="$(node --version | cut -d. -f1 | tr -d 'v')"
        [ "$_ver" -ge "$NODE_MAJOR" ] 2>/dev/null && _need_node=0
    fi

    if [ "$_need_node" -eq 1 ] || [ "$FORCE" -eq 1 ]; then
        info "Installing Node.js ${NODE_MAJOR} from NodeSource..."
        runcmd curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
            -o /tmp/nodesource.gpg.key
        if [ "$DRY_RUN" -eq 0 ]; then
            gpg --dearmor < /tmp/nodesource.gpg.key \
                > /usr/share/keyrings/nodesource.gpg
            printf 'deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' \
                "$NODE_MAJOR" > /etc/apt/sources.list.d/nodesource.list
        else
            printf "${YELLOW}[DRY]${RESET}   (would configure NodeSource repo)\n"
        fi
        runcmd apt-get update -qq
        runcmd apt-get install -y nodejs
    else
        info "Node.js $(node --version) already installed."
    fi

    ok "System packages ready."
}

# ---------------------------------------------------------------------------
# STEP: postgres
# ---------------------------------------------------------------------------
step_postgres() {
    step "Configuring PostgreSQL"

    # Start PostgreSQL if not running
    if ! pg_ctlcluster "$(pg_lsclusters -h | awk '{print $1}' | head -1)" \
                       main status >/dev/null 2>&1; then
        runcmd service postgresql start
    else
        info "PostgreSQL already running."
    fi

    if [ "$DRY_RUN" -eq 0 ]; then
        su -s /bin/sh postgres -c "
            psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" \
                | grep -q 1 \
            || psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\"

            psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" \
                | grep -q 1 \
            || psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\"

            psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\"
        "
    else
        printf "${YELLOW}[DRY]${RESET}   (would create PostgreSQL user/database)\n"
    fi

    ok "PostgreSQL database '${DB_NAME}' and user '${DB_USER}' ready."
}

# ---------------------------------------------------------------------------
# STEP: schema
# ---------------------------------------------------------------------------
step_schema() {
    step "Applying database schema and migrations"

    SCHEMA_FILE="${SRC_DIR}/database/schema.sql"
    MIG_DIR="${SRC_DIR}/database/migrations"

    [ -r "$SCHEMA_FILE" ] || die "Schema file not found: $SCHEMA_FILE"

    if [ "$DRY_RUN" -eq 0 ]; then
        PGPASSWORD="${DB_PASS}" psql \
            -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" \
            -f "$SCHEMA_FILE" 2>/dev/null || true
        ok "Base schema applied."

        # Apply every migration in numeric order (002, 003, ...).
        for MIG in "$MIG_DIR"/*.sql; do
            [ -r "$MIG" ] || continue
            PGPASSWORD="${DB_PASS}" psql \
                -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" \
                -f "$MIG"
            ok "Migration $(basename "$MIG") applied."
        done
    else
        printf "${YELLOW}[DRY]${RESET}   psql ... -f %s\n" "$SCHEMA_FILE"
        for MIG in "$MIG_DIR"/*.sql; do
            printf "${YELLOW}[DRY]${RESET}   psql ... -f %s\n" "$MIG"
        done
    fi

    ok "Schema up to date."
}

# ---------------------------------------------------------------------------
# STEP: venv
# ---------------------------------------------------------------------------
step_venv() {
    step "Setting up Python virtual environment"

    VENV_DIR="${APP_INSTALL_DIR}/venv"
    REQ_FILE="${SRC_DIR}/backend/requirements.txt"

    [ -r "$REQ_FILE" ] || die "requirements.txt not found: $REQ_FILE"

    if [ "$FORCE" -eq 0 ] && [ -x "${VENV_DIR}/bin/pip" ]; then
        info "Virtualenv exists at ${VENV_DIR}. Updating packages (use -f to recreate)."
        runcmd "${VENV_DIR}/bin/pip" install --upgrade pip wheel --quiet
        runcmd "${VENV_DIR}/bin/pip" install -r "$REQ_FILE" --quiet
    else
        [ "$FORCE" -eq 1 ] && runcmd rm -rf "$VENV_DIR"
        runcmd python3 -m venv "$VENV_DIR"
        runcmd "${VENV_DIR}/bin/pip" install --upgrade pip wheel --quiet
        runcmd "${VENV_DIR}/bin/pip" install -r "$REQ_FILE" --quiet
    fi

    if [ "$DRY_RUN" -eq 0 ]; then
        chown -R mufibu:mufibu "$VENV_DIR" 2>/dev/null || true
    fi

    ok "Python virtualenv ready at ${VENV_DIR}."
}

# ---------------------------------------------------------------------------
# STEP: config
# ---------------------------------------------------------------------------
step_config() {
    step "Writing backend environment configuration"

    resolve_jwt_secret
    resolve_seed_admin_password
    mkdir -p "${CONF_DIR}"

    if [ "$FORCE" -eq 0 ] && [ -r "${CONF_DIR}/backend.env" ]; then
        info "Config file already exists at ${CONF_DIR}/backend.env. Skipping (use -f to overwrite)."
        return 0
    fi

    if [ "$DRY_RUN" -eq 0 ]; then
        cat > "${CONF_DIR}/backend.env" <<EOF
APP_NAME=MuFiBu
DEBUG=false
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET_KEY=${JWT_SECRET_KEY}
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=${JWT_ACCESS_MINUTES}
JWT_REFRESH_TOKEN_EXPIRE_DAYS=${JWT_REFRESH_DAYS}
CORS_ORIGINS=${CORS_ORIGINS}
SEED_ADMIN_USERNAME=${SEED_ADMIN_USERNAME}
SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}
SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}
EOF
        chmod 640 "${CONF_DIR}/backend.env"
        chown root:mufibu "${CONF_DIR}/backend.env" 2>/dev/null || true
    else
        printf "${YELLOW}[DRY]${RESET}   (would write %s/backend.env)\n" "$CONF_DIR"
    fi

    ok "Config written to ${CONF_DIR}/backend.env"
}

# ---------------------------------------------------------------------------
# STEP: frontend
# ---------------------------------------------------------------------------
step_frontend() {
    step "Building React frontend"

    FRONTEND_SRC="${SRC_DIR}/frontend"
    [ -d "$FRONTEND_SRC" ] || die "Frontend source not found: $FRONTEND_SRC"

    # Ensure web root exists
    runcmd mkdir -p "${WEB_ROOT}"

    if [ "$DRY_RUN" -eq 0 ]; then
        cd "$FRONTEND_SRC"
        npm install --silent
        npm run build
        cp -r build/. "${WEB_ROOT}/"
        chown -R www-data:www-data "${WEB_ROOT}"
    else
        printf "${YELLOW}[DRY]${RESET}   cd %s && npm install && npm run build\n" "$FRONTEND_SRC"
        printf "${YELLOW}[DRY]${RESET}   cp -r build/. %s\n" "$WEB_ROOT"
    fi

    ok "Frontend built and deployed to ${WEB_ROOT}."
}

# ---------------------------------------------------------------------------
# STEP: nginx
# ---------------------------------------------------------------------------
step_nginx() {
    step "Configuring nginx"

    NGINX_SRC="${SRC_DIR}/nginx"
    [ -d "$NGINX_SRC" ] || die "nginx config directory not found: $NGINX_SRC"

    # Ensure a TLS certificate exists before nginx -t (the frontend site
    # references it).  Generate a self-signed placeholder if none is present;
    # replace it with a real certificate (e.g. Let's Encrypt) in production.
    if [ "$DRY_RUN" -eq 0 ]; then
        mkdir -p "$TLS_DIR"
        if [ ! -f "${TLS_DIR}/fullchain.pem" ] || [ ! -f "${TLS_DIR}/privkey.pem" ]; then
            openssl req -x509 -newkey rsa:2048 -nodes \
                -keyout "${TLS_DIR}/privkey.pem" \
                -out    "${TLS_DIR}/fullchain.pem" \
                -days 365 -subj "/CN=${TLS_CN}"
            chmod 600 "${TLS_DIR}/privkey.pem"
            chmod 644 "${TLS_DIR}/fullchain.pem"
            ok "Generated self-signed TLS certificate in ${TLS_DIR} (replace with a real cert)."
        else
            ok "TLS certificate already present in ${TLS_DIR}."
        fi
    else
        printf "${YELLOW}[DRY]${RESET}   generate self-signed cert in %s if missing\n" "$TLS_DIR"
    fi

    runcmd cp "${NGINX_SRC}/mufibu-frontend.conf" \
               /etc/nginx/sites-available/mufibu-frontend.conf
    runcmd cp "${NGINX_SRC}/mufibu-backend.conf" \
               /etc/nginx/sites-available/mufibu-backend.conf

    # The upstream definitions are embedded in the site configs. Remove the
    # legacy shared upstream file if it exists to avoid duplicate names.
    [ -e /etc/nginx/conf.d/mufibu-upstream.conf ] && \
        runcmd rm -f /etc/nginx/conf.d/mufibu-upstream.conf

    runcmd ln -sf /etc/nginx/sites-available/mufibu-frontend.conf \
                  /etc/nginx/sites-enabled/mufibu-frontend.conf
    runcmd ln -sf /etc/nginx/sites-available/mufibu-backend.conf \
                  /etc/nginx/sites-enabled/mufibu-backend.conf

    # Remove default site if present
    [ -e /etc/nginx/sites-enabled/default ] && runcmd rm -f /etc/nginx/sites-enabled/default

    runcmd nginx -t
    if service nginx status >/dev/null 2>&1; then
        runcmd service nginx reload
    else
        runcmd service nginx start
    fi

    ok "nginx configured and running."
}

# ---------------------------------------------------------------------------
# STEP: service
# ---------------------------------------------------------------------------
step_service() {
    step "Installing mufibu-backend SysVInit service"

    _ensure_app_dirs

    INIT_SCRIPT="${SRC_DIR}/init.d/mufibu-backend"
    [ -r "$INIT_SCRIPT" ] || die "Init script not found: $INIT_SCRIPT"

    runcmd cp "$INIT_SCRIPT" /etc/init.d/mufibu-backend
    runcmd chmod 755 /etc/init.d/mufibu-backend
    runcmd update-rc.d mufibu-backend defaults 90 10

    # Copy application source into install dir
    if [ "$DRY_RUN" -eq 0 ]; then
        cp -r "${SRC_DIR}/backend/." "${APP_INSTALL_DIR}/backend/"
        cp -r "${SRC_DIR}/database"  "${APP_INSTALL_DIR}/"
        chown -R mufibu:mufibu "${APP_INSTALL_DIR}" "${LOG_DIR}" "${RUN_DIR}"
    else
        printf "${YELLOW}[DRY]${RESET}   (would copy source to %s)\n" "$APP_INSTALL_DIR"
    fi

    if service mufibu-backend status >/dev/null 2>&1; then
        runcmd service mufibu-backend restart
    else
        runcmd service mufibu-backend start
    fi

    ok "mufibu-backend service installed and started."
}

# Helper used by service step and status
_ensure_app_dirs() {
    runcmd mkdir -p "${APP_INSTALL_DIR}/backend" "${WEB_ROOT}" \
                    "${LOG_DIR}" "${RUN_DIR}" "${CONF_DIR}"

    # Ensure system user exists
    if ! id mufibu >/dev/null 2>&1; then
        runcmd useradd --system --no-create-home --shell /usr/sbin/nologin mufibu
        ok "System user 'mufibu' created."
    fi

    # Ensure postgresql starts on boot
    runcmd update-rc.d postgresql defaults 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# STEP: status
# ---------------------------------------------------------------------------
step_status() {
    step "MuFiBu installation status"

    _chk() {
        _label="$1"; _cmd="$2"
        if eval "$_cmd" >/dev/null 2>&1; then
            printf "  ${GREEN}[OK]${RESET}    %s\n" "$_label"
        else
            printf "  ${RED}[MISSING]${RESET} %s\n" "$_label"
        fi
    }

    _chk "PostgreSQL running"          "service postgresql status"
    _chk "Database '${DB_NAME}'"       "PGPASSWORD=${DB_PASS} psql -h 127.0.0.1 -U ${DB_USER} -d ${DB_NAME} -c '\\q'"
    _chk "Python virtualenv"           "[ -x ${APP_INSTALL_DIR}/venv/bin/python3 ]"
    _chk "Backend config"              "[ -r ${CONF_DIR}/backend.env ]"
    _chk "Frontend deployed"           "[ -d ${WEB_ROOT} ] && ls ${WEB_ROOT}/index.html"
    _chk "nginx running"               "service nginx status"
    _chk "nginx site: mufibu-frontend" "[ -L /etc/nginx/sites-enabled/mufibu-frontend.conf ]"
    _chk "nginx site: mufibu-backend"  "[ -L /etc/nginx/sites-enabled/mufibu-backend.conf ]"
    _chk "Init script installed"       "[ -x /etc/init.d/mufibu-backend ]"
    _chk "mufibu-backend running"      "service mufibu-backend status"
    _chk "API health endpoint"         "curl -sf http://127.0.0.1:8080/api/v1/health"
    _chk "API DB connectivity"         "curl -sf http://127.0.0.1:8080/api/v1/health/db"
    _chk "Node.js 20+"                 "node --version | grep -E '^v(2[0-9]|[3-9][0-9])'"
    printf "\n"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
_setup_colors
parse_args "$@"
load_config

require_root

[ "$DRY_RUN" -eq 1 ] && warn "Dry-run mode - no changes will be made."

for _step in $STEPS; do
    case "$_step" in
        deps)     step_deps     ;;
        postgres) step_postgres ;;
        schema)   step_schema   ;;
        venv)     step_venv     ;;
        config)   step_config   ;;
        frontend) step_frontend ;;
        nginx)    step_nginx    ;;
        service)  step_service  ;;
        status)   step_status   ;;
        *) die "Unknown step: '$_step'  (try -h for help)" ;;
    esac
done

# ---------------------------------------------------------------------------
# Post-all summary (only if we ran the full stack)
# ---------------------------------------------------------------------------
_ran_all=0
for _s in deps postgres schema venv config frontend nginx service; do
    echo "$STEPS" | grep -qw "$_s" && _ran_all=$(( _ran_all + 1 ))
done

if [ "$_ran_all" -ge 8 ] && [ "$DRY_RUN" -eq 0 ]; then
    printf "\n${BOLD}============================================================${RESET}\n"
    printf "${GREEN} MuFiBu installation complete!${RESET}\n"
    printf "${BOLD}============================================================${RESET}\n"
    printf " Frontend:   http://%s/\n"        "$(hostname -I | awk '{print $1}')"
    printf " API health: http://%s/api/v1/health\n" "$(hostname -I | awk '{print $1}')"
    printf "\n Initial PowerAdmin credentials:\n"
    printf "   Username: %s\n" "$SEED_ADMIN_USERNAME"
    if [ "${SHOW_SEED_PASSWORD:-0}" -eq 1 ]; then
        printf "   Password: %s\n" "$SEED_ADMIN_PASSWORD"
    else
        printf "   Password: stored in %s/backend.env (not printed)\n" "$CONF_DIR"
    fi
    printf "\n${YELLOW} IMPORTANT: Change the admin password after first login!${RESET}\n"
    printf " Config:     %s/backend.env\n" "$CONF_DIR"
    printf " Logs:       %s/\n"            "$LOG_DIR"
    printf "${BOLD}============================================================${RESET}\n\n"
fi
