#!/usr/bin/env bash
# Activa HTTPS con Let's Encrypt. Sin dominio propio se puede usar <IP-con-guiones>.sslip.io
# (servicio DNS gratuito que resuelve ese nombre a esa IP).
# Uso (como root):  bash enable-https.sh            -> usa <ip>.sslip.io automáticamente
#                   bash enable-https.sh midominio.com
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Ejecutá como root (o con sudo)."; exit 1; }
IP=$(curl -fsS -4 https://api.ipify.org)
DOMAIN=${1:-${IP//./-}.sslip.io}
CONF=/etc/nginx/sites-available/barrio-alerta

echo "Dominio: $DOMAIN (IP pública: $IP)"
RESOLVED=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')
[ "$RESOLVED" = "$IP" ] || { echo "El DNS de $DOMAIN apunta a '${RESOLVED:-nada}', no a $IP. Revisá el registro A."; exit 1; }

apt-get install -y -q certbot python3-certbot-nginx
sed -i "s/server_name .*;/server_name $DOMAIN;/" "$CONF"
nginx -t && systemctl reload nginx

# Sin email: Let's Encrypt ya no envía avisos de vencimiento y la renovación es automática.
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
systemctl list-timers certbot.timer --no-pager || true
echo "Listo: https://$DOMAIN"
