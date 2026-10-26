# Guía de diagnóstico

## Regla de oro: ir capa por capa, de afuera hacia adentro

```
Navegador → DNS → Firewall (panel + UFW) → Nginx → Node (systemd) → SQLite / API de IA
```

| Síntoma | Capa probable | Primer comando |
|---|---|---|
| "No se puede acceder al sitio" / timeout | DNS, firewall o servidor apagado | `ping IP`, `Test-NetConnection IP -Port 80` (PowerShell) |
| `502 Bad Gateway` | Node caído (Nginx funciona) | `systemctl status barrio-alerta` |
| `504 Gateway Timeout` | Node lento (¿la IA?) | `journalctl -u barrio-alerta -n 50` |
| Página en blanco, consola con errores | Frontend | F12 → Console y Network |
| `500` en una petición de la API | Backend | `journalctl -u barrio-alerta -f` |
| "IA no configurada" | Variable de entorno | `sudo grep -c OPENAI_API_KEY= /etc/barrio-alerta/barrio-alerta.env` |
| Certificado inválido | HTTPS / Certbot | `certbot certificates` |

Resumen automático: `bash /opt/barrio-alerta/deploy/healthcheck.sh https://tu-url`

## Comandos esenciales

```bash
# Logs
journalctl -u barrio-alerta -n 100 --no-pager      # últimos logs de la app
journalctl -u barrio-alerta -f                      # en vivo (Ctrl+C para salir)
tail -f /var/log/nginx/barrio-alerta.error.log
tail -f /var/log/nginx/barrio-alerta.access.log

# Procesos y puertos
systemctl status barrio-alerta nginx
ss -tlnp                                            # quién escucha en cada puerto
ps aux --sort=-rss | head                           # procesos que más RAM usan

# Recursos
free -h          # RAM ("available" es lo que importa)
df -h /          # disco
du -sh /var/log /var/lib/barrio-alerta
journalctl --disk-usage
```

## Escenarios frecuentes

### SSH: "Connection timed out" o "Connection refused"
- **Timeout:** IP equivocada, servidor apagado o firewall del panel bloqueando. Revisá el panel.
- **Refused:** el servidor responde pero no hay SSH en ese puerto. ¿Es otro puerto? Probá `ssh -p 2222 ...`.
- **Permission denied (publickey):** la clave no está en `authorized_keys`, o estás usando otra clave. Probá con `ssh -v` para ver qué claves intenta.
- **Diagnóstico desde Windows:** `Test-NetConnection IP -Port 22`.
- Si te bloqueaste con UFW, entrá por la **consola web (VNC)** del panel de DonWeb y ejecutá `ufw allow 22/tcp`.

### Permisos: `EACCES` / `SQLITE_CANTOPEN`
```bash
ls -la /var/lib/barrio-alerta        # dueño: barrio
chown -R barrio:barrio /var/lib/barrio-alerta
```
systemd solo deja escribir en `ReadWritePaths`. Si cambiaste `DB_PATH` a otro lugar, la app no va a poder escribir.

### Puerto ocupado: `EADDRINUSE`
```bash
ss -tlnp | grep :3000      # ¿qué proceso lo usa?
```
Suele ser una instancia lanzada a mano con `npm start`. Cortala y dejá que systemd maneje la app.

### Falta una variable de entorno
La app se niega a arrancar y explica qué falta (por ejemplo, `ADMIN_TOKEN debe tener al menos 16 caracteres`).
Revisá `journalctl -u barrio-alerta -n 20`.

### Backend que no inicia
1. `journalctl -u barrio-alerta -n 50`: el error real casi siempre está ahí.
2. Ejecutalo a mano con las mismas variables:
   `sudo -u barrio bash -c 'set -a; . /etc/barrio-alerta/barrio-alerta.env; cd /opt/barrio-alerta; node src/server.js'`
3. `Cannot find module`: faltó `npm ci`. `SyntaxError`: versión de Node vieja (`node -v`).

### 502 de Nginx
Nginx anda pero Node no responde en 127.0.0.1:3000. `curl 127.0.0.1:3000/api/health` lo confirma.
Arreglá Node; Nginx no tiene la culpa.

### DNS
```bash
nslookup midominio.com         # en Windows o Linux
getent hosts midominio.com     # en Linux
```
Un registro A nuevo puede tardar en propagarse. `<ip-con-guiones>.sslip.io` funciona al instante.

### Certificado HTTPS fallido
- El puerto 80 tiene que estar abierto desde Internet (Let's Encrypt valida por HTTP).
- El DNS tiene que apuntar a esta IP.
- Rate limit de Let's Encrypt: no repitas el comando 10 veces seguidas. Probá con `--dry-run`.
- `certbot certificates` y `certbot renew --dry-run`.

### Memoria insuficiente
```bash
free -h
dmesg -T | grep -i -E 'killed process|out of memory'
```
La app tiene `MemoryMax=400M` y usa ~50 MB. Los picos suelen venir de `npm install` o `apt`.
Un swap de 1 GB es razonable si `available` baja de ~300 MB al instalar (hay que pedir autorización antes).

### Reinicio del servidor
`systemctl is-enabled barrio-alerta nginx` tiene que responder `enabled` en los dos. Para probarlo: `reboot`,
esperar un minuto y volver a abrir la URL.

### Error de la API de IA
El reclamo se guarda igual y aparece el motivo: 401 (key inválida), 404 (modelo inexistente: cambiá `OPENAI_MODEL`),
429 (límite) o timeout. Después de corregir la variable: `systemctl restart barrio-alerta` y el botón "Analizar con IA".
