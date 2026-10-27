# Despliegue en un Cloud Server de DonWeb

Esta guía sirve para hacerlo **a mano y entendiendo cada paso** (lo que vas a necesitar en la hackatón)
y también con los scripts de `deploy/`.

## 0. Conceptos mínimos

| Concepto | Qué es |
|---|---|
| **Imagen** | La plantilla de disco con la que nace el servidor (por ejemplo, "Ubuntu 24.04 LTS"). Reinstalar la imagen **borra todo**. |
| **SSH** | Conexión cifrada a la terminal del servidor. Puerto 22 por defecto. |
| **Clave SSH** | Un par de archivos: la **privada** queda en tu PC (nunca se comparte) y la **pública** se copia al servidor. |
| **Nginx** | Servidor web público (puertos 80/443) que reenvía las peticiones a Node (proxy inverso). |
| **systemd** | Gestor de servicios de Linux: arranca la app con el sistema y la reinicia si se cae. |
| **UFW** | Firewall sencillo de Ubuntu. |

**Imagen recomendada:** Ubuntu Server LTS en la versión más nueva que ofrezca el panel (24.04 o 26.04).
LTS significa 5 años de actualizaciones de seguridad. No elijas versiones que no sean LTS.

## 1. Datos del panel de DonWeb

En el panel (donweb.com → Mi cuenta → Cloud Server → tu servidor) buscá:

- **IP pública** (IPv4).
- **Sistema operativo** instalado.
- **Usuario** (normalmente `root`) y **contraseña inicial** (a veces llega por email).
- **Puerto SSH** (22 salvo que diga otra cosa).
- **Firewall del panel**, si existe: tiene que permitir 22, 80 y 443 *además* de UFW.
- **Estado** (encendido) y **backups**.

## 2. Clave SSH desde Windows (PowerShell)

```powershell
# Crear la clave (Enter = sin passphrase; con passphrase es más seguro pero pide clave en cada uso)
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\donweb_ed25519 -C "donweb-practica"

# Copiar la pública al servidor (pide la contraseña del servidor UNA vez; escribila en la terminal, no en el chat)
type $env:USERPROFILE\.ssh\donweb_ed25519.pub | ssh root@IP "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"

# Probar: no debería pedir contraseña
ssh -i $env:USERPROFILE\.ssh\donweb_ed25519 root@IP "hostname; cat /etc/os-release | head -2"
```

Atajo opcional en `C:\Users\<vos>\.ssh\config`:

```
Host donweb
    HostName IP
    User root
    Port 22
    IdentityFile ~/.ssh/donweb_ed25519
```

Después alcanza con `ssh donweb`.

## 3. Preparar el servidor (a mano)

```bash
apt update && apt -y upgrade
apt install -y nginx ufw git sqlite3 curl
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs
node -v

# Usuario sin privilegios para la app
useradd --system --home-dir /var/lib/barrio-alerta --shell /usr/sbin/nologin barrio
mkdir -p /var/lib/barrio-alerta && chown barrio:barrio /var/lib/barrio-alerta

# Firewall: PRIMERO permitir SSH, después activar
ufw allow 5911/tcp    # puerto SSH de DonWeb (ver panel); en otros proveedores suele ser 22
ufw allow 80/tcp
ufw allow 443/tcp
ufw show added        # ¿aparece el puerto SSH? Si no, NO sigas
ufw enable
systemctl enable ufw  # que siga activo después de reiniciar
ufw status
```

> Antes de `ufw enable`, verificá que la regla de SSH está creada. Mantené una sesión SSH abierta y probá
> abrir otra nueva. Si la segunda conecta, no te quedaste afuera.

### Desactivar el login SSH con contraseña (solo cuando la clave ya funciona)

```bash
# Red de seguridad: si en 3 minutos no la cancelás, el cambio se deshace solo
systemd-run --unit=ssh-rollback --on-active=180 /bin/sh -c "rm -f /etc/ssh/sshd_config.d/01-hardening.conf; systemctl reload ssh"
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/01-hardening.conf
sshd -t && systemctl reload ssh
# Desde OTRA terminal: ssh -p 5911 root@IP  -> si entra con la clave, cancelar la vuelta atrás:
systemctl stop ssh-rollback.timer
```

El archivo empieza con `01-` porque en `sshd_config.d` gana el **primer** valor leído. DonWeb trae un
`custom.conf` con `PermitRootLogin yes`, y el nuestro se lee antes. La consola web del panel sigue aceptando contraseña.

Con script: `bash deploy/setup-server.sh` hace todo esto y además crea `/etc/barrio-alerta/barrio-alerta.env`.

## 4. Subir el código

**Opción A: GitHub (la de la hackatón).**

```bash
git clone https://github.com/felipe-artigas/barrio-alerta.git /root/barrio-alerta
```

**Opción B: desde Windows, sin GitHub.**

```powershell
.\deploy\deploy.ps1 -Server IP
```

## 5. Variables de entorno de producción

```bash
nano /etc/barrio-alerta/barrio-alerta.env     # cargar OPENAI_API_KEY acá, nunca en el repo
chown root:barrio /etc/barrio-alerta/barrio-alerta.env && chmod 640 /etc/barrio-alerta/barrio-alerta.env
```

## 6. Instalar y arrancar la app

```bash
bash /root/barrio-alerta/deploy/remote-install.sh /root/barrio-alerta
```

A mano, sería:

```bash
cp -r /root/barrio-alerta /opt/barrio-alerta && cd /opt/barrio-alerta && npm ci --omit=dev
cp deploy/barrio-alerta.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now barrio-alerta
systemctl status barrio-alerta
cp deploy/nginx.conf /etc/nginx/sites-available/barrio-alerta
ln -s /etc/nginx/sites-available/barrio-alerta /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
curl http://127.0.0.1/api/health
```

## 7. HTTPS

Sin dominio propio, `203-0-113-10.sslip.io` resuelve a `203.0.113.10`, y Let's Encrypt emite certificados para ese nombre.

```bash
bash /opt/barrio-alerta/deploy/enable-https.sh                # usa <ip>.sslip.io
bash /opt/barrio-alerta/deploy/enable-https.sh midominio.com  # con dominio propio (registro A -> IP)
```

## 8. Actualizar sin perder datos

La base está en `/var/lib/barrio-alerta`, fuera del código. Actualizar reemplaza solo `/opt/barrio-alerta`.

```bash
cd /root/barrio-alerta && git pull
bash deploy/remote-install.sh /root/barrio-alerta   # si la nueva versión no arranca, vuelve sola a la anterior
```

## 9. Backups

- Automático: cron diario a las 04:15, en `/var/lib/barrio-alerta/backups` (se guardan 7).
- Manual: `sudo -u barrio bash -c 'set -a; . /etc/barrio-alerta/barrio-alerta.env; cd /opt/barrio-alerta; node src/backup.js'`
- Restaurar: `systemctl stop barrio-alerta`, copiar el backup sobre `barrio-alerta.sqlite` (y borrar los `-wal`/`-shm`), `chown barrio:barrio` y `systemctl start barrio-alerta`.
- Copia fuera del servidor: `scp donweb:/var/lib/barrio-alerta/backups/<archivo> .`
