#!/usr/bin/env bash
# Prepara un Ubuntu Server limpio para Barrio Alerta. Idempotente: se puede ejecutar varias veces.
# Uso (como root):  bash setup-server.sh
set -euo pipefail

APP=barrio-alerta
APP_USER=barrio
APP_DIR=/opt/$APP
DATA_DIR=/var/lib/$APP
ENV_DIR=/etc/$APP
ENV_FILE=$ENV_DIR/$APP.env
NODE_MAJOR=24

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Ejecutá este script como root (o con sudo)."; exit 1; }
. /etc/os-release
[ "$ID" = "ubuntu" ] || echo "Aviso: probado en Ubuntu; detectado $PRETTY_NAME."

log "1/7 Actualizando paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q upgrade
apt-get install -y -q --no-install-recommends ca-certificates curl gnupg git nginx ufw sqlite3 openssl

log "2/7 Instalando Node.js $NODE_MAJOR (repositorio oficial NodeSource)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -q nodejs
fi
echo "node $(node -v) · npm $(npm -v)"

log "3/7 Usuario de sistema '$APP_USER' (sin shell ni sudo) y directorios"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
install -d -m 755 -o root -g root "$APP_DIR"            # código: solo root escribe
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR" "$DATA_DIR/backups"  # datos: solo la app
install -d -m 750 -o root -g "$APP_USER" "$ENV_DIR"

log "4/7 Archivo de variables de entorno ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  umask 027
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DB_PATH=$DATA_DIR/$APP.sqlite
ADMIN_TOKEN=$(openssl rand -hex 24)
TRUST_PROXY=1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=20000
AI_DAILY_LIMIT=200
SEED_DEMO=true
EOF
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "Creado. ADMIN_TOKEN generado al azar; para verlo: sudo grep ADMIN_TOKEN $ENV_FILE"
else
  echo "Ya existe: no se modifica."
fi

log "5/7 Límite de tamaño de logs (journald 200 MB)"
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/size.conf
systemctl restart systemd-journald

log "6/7 Firewall UFW: SSH + HTTP/HTTPS"
# Se detectan TODOS los puertos donde escucha sshd para no perder el acceso remoto.
SSH_PORTS=$(ss -tlnpH 2>/dev/null | awk '/sshd|"ssh"/ {n=split($4,a,":"); print a[n]}' | sort -u)
[ -n "$SSH_PORTS" ] || SSH_PORTS=22
for p in $SSH_PORTS; do ufw allow "$p/tcp" comment 'SSH'; done
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
# Monitoreo del proveedor (SNMP): solo desde las IPs que ya autoriza snmpd.conf.
if [ -f /etc/snmp/snmpd.conf ]; then
  for ip in $(awk '$1=="com2sec" && $3 ~ /^[0-9.]+$/ {print $3}' /etc/snmp/snmpd.conf | sort -u); do
    ufw allow from "$ip" to any port 161 proto udp comment 'SNMP proveedor'
  done
fi
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
ufw status verbose

# Si hay un servidor de correo preinstalado, que solo escuche localmente (no expuesto a Internet).
if command -v postconf >/dev/null && [ "$(postconf -h inet_interfaces)" != "loopback-only" ]; then
  postconf -e inet_interfaces=loopback-only
  systemctl restart postfix
fi

log "7/7 Nginx base"
rm -f /etc/nginx/sites-enabled/default
systemctl enable --now nginx

echo
echo "Servidor preparado. Siguiente paso: instalar la app con deploy/remote-install.sh"
