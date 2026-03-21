#!/bin/sh
# =============================================================================
# MuFiBu Setup Script for Devuan (SysVInit)
# =============================================================================
# Installs and configures:
#   - PostgreSQL 15
#   - Python 3 + virtualenv + backend dependencies
#   - Node.js 20 LTS + npm + React frontend build
#   - nginx (two site configurations: frontend :80, backend proxy :8080)
#   - SysVInit service: mufibu-backend
#
# Run as root: sh setup.sh
# =============================================================================

set -e

# ---------------------------------------------------------------------------
# Configuration - edit these values before running
# ---------------------------------------------------------------------------
DB_NAME=mufibu
DB_USER=mufibu
DB_PASS=mufibu_db_password      # CHANGE THIS in production
APP_DIR=/opt/mufibu
WEB_ROOT=/var/www/mufibu/frontend
LOG_DIR=/var/log/mufibu
RUN_DIR=/var/run/mufibu
CONF_DIR=/etc/mufibu

BACKEND_SECRET_KEY="replace-with-a-long-random-string-$(head -c 32 /dev/urandom | base64 | tr -d '/+=\n')"
SEED_ADMIN_PASSWORD=ChangeMe1!  # CHANGE THIS immediately after first login

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '\n[INFO]  %s\n' "$*"; }
ok()    { printf '[OK]    %s\n' "$*"; }
die()   { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

require_root() {
    [ "$(id -u)" -eq 0 ] || die "This script must be run as root."
}

# ---------------------------------------------------------------------------
# 0. Preflight checks
# ---------------------------------------------------------------------------
require_root
info "MuFiBu setup starting on $(uname -n)"

# Detect Devuan / Debian
. /etc/os-release 2>/dev/null || true
info "Detected OS: ${PRETTY_NAME:-unknown}"

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
info "Updating package lists ..."
apt-get update -qq

info "Installing system dependencies ..."
apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    build-essential \
    libssl-dev \
    libffi-dev \
    libpq-dev \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    postgresql \
    postgresql-client \
    nginx \
    git \
    openssl \
    procps

ok "System packages installed."

# ---------------------------------------------------------------------------
# 2. Node.js 20 (via NodeSource)
# ---------------------------------------------------------------------------
info "Setting up Node.js 20 repository ..."
NODE_MAJOR=20

if ! command -v node >/dev/null 2>&1 || \
   [ "$(node --version | cut -d. -f1 | tr -d 'v')" -lt "$NODE_MAJOR" ]; then

    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg

    echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] \
https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list

    apt-get update -qq
    apt-get install -y nodejs
fi

ok "Node.js $(node --version) installed."

# ---------------------------------------------------------------------------
# 3. PostgreSQL setup
# ---------------------------------------------------------------------------
info "Configuring PostgreSQL ..."

# Start PostgreSQL if not running
if ! pg_ctlcluster $(pg_lsclusters -h | awk '{print $1}' | head -1) \
                   main status >/dev/null 2>&1; then
    service postgresql start
fi

# Create user and database if they do not exist
su -s /bin/sh postgres -c "
    psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" \
        | grep -q 1 \
    || psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\"

    psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" \
        | grep -q 1 \
    || psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\"

    psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\"
"

ok "PostgreSQL database and user ready."

# Apply schema
info "Applying database schema ..."
PGPASSWORD="${DB_PASS}" psql \
    -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" \
    -f "${APP_DIR}/database/schema.sql" 2>/dev/null || true
ok "Schema applied (errors above may be safe if schema already exists)."

# ---------------------------------------------------------------------------
# 4. Application user
# ---------------------------------------------------------------------------
info "Creating system user 'mufibu' ..."
id mufibu >/dev/null 2>&1 \
    || useradd --system --no-create-home --shell /usr/sbin/nologin mufibu
ok "User 'mufibu' ready."

# ---------------------------------------------------------------------------
# 5. Application directory structure
# ---------------------------------------------------------------------------
info "Creating directory structure ..."
mkdir -p "${APP_DIR}/backend"
mkdir -p "${WEB_ROOT}"
mkdir -p "${LOG_DIR}"
mkdir -p "${RUN_DIR}"
mkdir -p "${CONF_DIR}"

# Copy application source
cp -r /home/user/mufibu/backend/* "${APP_DIR}/backend/"
cp -r /home/user/mufibu/database  "${APP_DIR}/"
cp -r /home/user/mufibu/frontend  "${APP_DIR}/"

chown -R mufibu:mufibu "${APP_DIR}" "${LOG_DIR}" "${RUN_DIR}"
chmod 750 "${APP_DIR}" "${LOG_DIR}" "${RUN_DIR}"

ok "Directories created."

# ---------------------------------------------------------------------------
# 6. Python virtual environment and backend dependencies
# ---------------------------------------------------------------------------
info "Creating Python virtual environment ..."
python3 -m venv /opt/mufibu/venv
/opt/mufibu/venv/bin/pip install --upgrade pip wheel --quiet
/opt/mufibu/venv/bin/pip install -r "${APP_DIR}/backend/requirements.txt" --quiet
chown -R mufibu:mufibu /opt/mufibu/venv
ok "Python virtualenv ready."

# ---------------------------------------------------------------------------
# 7. Backend environment configuration
# ---------------------------------------------------------------------------
info "Writing backend environment file ..."
cat > "${CONF_DIR}/backend.env" <<EOF
APP_NAME=MuFiBu
DEBUG=false
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET_KEY=${BACKEND_SECRET_KEY}
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
CORS_ORIGINS=["http://localhost","http://localhost:80"]
SEED_ADMIN_USERNAME=poweradmin
SEED_ADMIN_EMAIL=poweradmin@mufibu.local
SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}
EOF
chmod 640 "${CONF_DIR}/backend.env"
chown root:mufibu "${CONF_DIR}/backend.env"
ok "Backend environment file written to ${CONF_DIR}/backend.env"

# ---------------------------------------------------------------------------
# 8. React frontend build
# ---------------------------------------------------------------------------
info "Installing npm dependencies ..."
cd "${APP_DIR}/frontend"
npm install --silent

info "Building React application ..."
npm run build

info "Deploying frontend build to ${WEB_ROOT} ..."
cp -r "${APP_DIR}/frontend/build/." "${WEB_ROOT}/"
chown -R www-data:www-data "${WEB_ROOT}"
ok "Frontend built and deployed."

# ---------------------------------------------------------------------------
# 9. nginx configuration
# ---------------------------------------------------------------------------
info "Configuring nginx ..."

# Install our two site configurations
cp /home/user/mufibu/nginx/mufibu-frontend.conf \
    /etc/nginx/sites-available/mufibu-frontend.conf
cp /home/user/mufibu/nginx/mufibu-backend.conf \
    /etc/nginx/sites-available/mufibu-backend.conf

# The backend upstream definition must be visible to the frontend conf.
# We place the upstream block in conf.d/ so it is included globally.
cat > /etc/nginx/conf.d/mufibu-upstream.conf <<'UPEOF'
upstream mufibu_backend {
    server 127.0.0.1:8080;
    keepalive 16;
}
UPEOF

# Enable sites
ln -sf /etc/nginx/sites-available/mufibu-frontend.conf \
       /etc/nginx/sites-enabled/mufibu-frontend.conf
ln -sf /etc/nginx/sites-available/mufibu-backend.conf \
       /etc/nginx/sites-enabled/mufibu-backend.conf

# Remove default site if present
rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
nginx -t
service nginx reload || service nginx start
ok "nginx configured."

# ---------------------------------------------------------------------------
# 10. SysVInit service
# ---------------------------------------------------------------------------
info "Installing SysVInit service ..."
cp /home/user/mufibu/init.d/mufibu-backend /etc/init.d/mufibu-backend
chmod 755 /etc/init.d/mufibu-backend

# Register service with update-rc.d
update-rc.d mufibu-backend defaults 90 10

# Start the backend service now
service mufibu-backend start
ok "mufibu-backend service installed and started."

# ---------------------------------------------------------------------------
# 11. PostgreSQL autostart
# ---------------------------------------------------------------------------
info "Ensuring PostgreSQL starts on boot ..."
update-rc.d postgresql defaults 2>/dev/null || true

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
info "============================================================"
info " MuFiBu installation complete!"
info "============================================================"
info " Frontend:      http://$(hostname -I | awk '{print $1}')/"
info " API health:    http://$(hostname -I | awk '{print $1}')/api/v1/health"
info ""
info " Initial PowerAdmin credentials:"
info "   Username: poweradmin"
info "   Password: ${SEED_ADMIN_PASSWORD}"
info ""
info " IMPORTANT: Change the admin password after first login!"
info " Config:    ${CONF_DIR}/backend.env"
info " Logs:      ${LOG_DIR}/"
info "============================================================"
