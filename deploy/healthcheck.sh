#!/usr/bin/env bash
# Diagnóstico rápido por capas. Uso en el servidor:  bash healthcheck.sh [url-pública]
APP=barrio-alerta
PUBLIC_URL=${1:-}
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$*"; }

echo "1) Servicio systemd"
systemctl is-active --quiet $APP && ok "$APP activo" || fail "$APP NO activo -> journalctl -u $APP -n 50"

echo "2) Puerto interno 3000"
ss -tln | grep -q '127.0.0.1:3000' && ok "Node escucha en 127.0.0.1:3000" || fail "Nadie escucha en :3000"

echo "3) API directa (sin Nginx)"
curl -fsS -m 5 http://127.0.0.1:3000/api/health >/dev/null && ok "API responde" || fail "API no responde"

echo "4) Nginx"
systemctl is-active --quiet nginx && ok "nginx activo" || fail "nginx NO activo -> sudo nginx -t"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/health)
[ "$code" = 200 ] && ok "Nginx -> Node OK (200)" || fail "Nginx devolvió $code (502 = Node caído)"

echo "5) Firewall"
ufw status | grep -qE '^(80|443)/tcp.*ALLOW' && ok "80/443 permitidos" || fail "Revisá: sudo ufw status"

echo "6) Recursos"
free -m | awk '/Mem:/ {printf "  RAM usada %s/%s MB (disponible %s MB)\n", $3, $2, $7}'
df -h / | awk 'NR==2 {printf "  Disco usado %s de %s (%s)\n", $3, $2, $5}'
ps -o rss=,cmd= -C node | awk '{printf "  node RSS %d MB\n", $1/1024}'

if [ -n "$PUBLIC_URL" ]; then
  echo "7) URL pública"
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$PUBLIC_URL/api/health")
  [ "$code" = 200 ] && ok "$PUBLIC_URL responde 200" || fail "$PUBLIC_URL devolvió $code"
fi
