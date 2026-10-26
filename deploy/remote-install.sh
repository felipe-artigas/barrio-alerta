#!/usr/bin/env bash
# Instala o actualiza la app desde un directorio con el código (git clone o tarball extraído).
# Los datos viven en /var/lib/barrio-alerta, así que actualizar NUNCA borra la base de datos.
# Uso (como root):  bash deploy/remote-install.sh /ruta/al/codigo
set -euo pipefail

SRC=$(realpath "${1:?Indicá el directorio con el código}")
APP=barrio-alerta
APP_DIR=/opt/$APP
NEW=$APP_DIR.new
PREV=$APP_DIR.prev

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Ejecutá como root (o con sudo)."; exit 1; }
[ -f "$SRC/package.json" ] || { echo "No encuentro package.json en $SRC"; exit 1; }

log "Copiando código a $NEW"
rm -rf "$NEW"
mkdir -p "$NEW"
tar -C "$SRC" --exclude=.git --exclude=node_modules --exclude=data --exclude=.env -cf - . | tar -C "$NEW" -xf -

log "Instalando dependencias de producción"
(cd "$NEW" && npm ci --omit=dev --no-audit --no-fund)
chown -R root:root "$NEW"
chmod -R go-w "$NEW"

log "Instalando servicio systemd, Nginx y cron de backups"
install -m 644 "$NEW/deploy/$APP.service" /etc/systemd/system/$APP.service
install -m 644 "$NEW/deploy/$APP.cron" /etc/cron.d/$APP
if [ ! -f /etc/nginx/sites-available/$APP ]; then
  # Solo la primera vez: después Certbot modifica este archivo para HTTPS y no hay que pisarlo.
  install -m 644 "$NEW/deploy/nginx.conf" /etc/nginx/sites-available/$APP
  ln -sf /etc/nginx/sites-available/$APP /etc/nginx/sites-enabled/$APP
fi
nginx -t
systemctl daemon-reload

log "Activando la nueva versión"
rm -rf "$PREV"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$PREV"
mv "$NEW" "$APP_DIR"
systemctl enable $APP >/dev/null 2>&1
systemctl restart $APP
systemctl reload nginx

log "Verificando salud"
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    curl -sS http://127.0.0.1:3000/api/health; echo
    echo "Despliegue OK."
    exit 0
  fi
  sleep 1
done

echo "La app no responde. Últimos logs:"
journalctl -u $APP -n 30 --no-pager
if [ -d "$PREV" ]; then
  echo "Volviendo a la versión anterior..."
  rm -rf "$APP_DIR"
  mv "$PREV" "$APP_DIR"
  systemctl restart $APP
fi
exit 1
