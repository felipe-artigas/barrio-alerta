# Checklist para el 1 de noviembre

> Regla oficial: **no se admite código escrito antes del evento** y los commits tienen que reflejar
> que el trabajo se hizo durante la hackatón. **No reutilices este repositorio.** Lo que llevás es
> conocimiento y práctica. Si querés usar scripts propios de servidor, consultalo antes con la organización.

## Antes del evento (casa)

- [ ] Notebook y cargador. VS Code, Git y Node instalados (`node -v`, `git --version`).
- [ ] Herramienta de IA con créditos activos y probada.
- [ ] Cuenta de GitHub con sesión iniciada en el navegador y en Git (probá un `git push` a un repo de prueba).
- [ ] Clave SSH creada (`~/.ssh/*.pub`), así el día del evento solo hay que copiarla al servidor nuevo.
- [ ] Practicar el deploy completo **de memoria** al menos 2 veces, con cronómetro (objetivo: menos de 30 min).
- [ ] Saber de memoria: `ssh`, `apt`, `ufw`, `systemctl`, `journalctl`, `nginx -t`, `curl`.

## Lecciones de la práctica (errores reales que pasaron)

1. **DonWeb usa el puerto SSH 5911, no el 22.** Está en el panel: "Conexión: `ssh -p5911 root@IP`". El 22 está bloqueado desde Internet.
2. **Firewall: casi me quedo afuera.** UFW quedó activo sin la regla del 5911. Antes de `ufw enable`:
   `ufw allow 5911/tcp` → `ufw show added` (confirmar que aparece) → `ufw enable` → **abrir una SEGUNDA conexión SSH** sin cerrar la primera.
   Después: `systemctl enable ufw` para que siga activo tras un reinicio.
3. **Rescate: consola web (VNC) del panel.** No pasa por el firewall. Usa teclado **estadounidense**: `/` está en la tecla `-` y `_` es Shift + la tecla a la derecha del `0`. Escribí la contraseña primero en `login:` (ahí se ve) para comprobar los símbolos.
4. **La pestaña "SSH Key" del panel dio error.** Plan B: contraseña de root y después
   `type $env:USERPROFILE\.ssh\<clave>.pub | ssh -p 5911 root@IP "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"`.
5. **Nunca muestres contraseñas en capturas ni en el chat.** Si pasa, generá una nueva.
6. **Después de Certbot, `http://IP` da 404.** Hay que redirigirlo al dominio (lo hace `enable-https.sh`).
7. **El antivirus (Avast) "firma" los certificados en tu PC.** Para ver el emisor real, revisalo desde el servidor.

## Plan de tiempo (15:15 a 18:30 = 3 h 15 min)

| Hora | Tarea |
|---|---|
| 15:15–15:30 | Leer la consigna. Definir problema, usuario y 3 funcionalidades de demo. Elegir qué hace la IA. |
| 15:30–15:45 | **Conectar al servidor y prepararlo** (paquetes, Node, firewall, Nginx). Mientras instala, armar el repo. |
| 15:45–16:00 | Esqueleto (Express + HTML + SQLite + `/api/health`). **Primer deploy ya** con la página mínima. |
| 16:00–17:30 | Funcionalidades + IA. Commit y deploy cada ~30 min. |
| 17:30–18:00 | Pulido, manejo de errores de IA, datos de ejemplo, README. |
| 18:00–18:15 | Deploy final, HTTPS, prueba desde el celular con datos móviles. |
| 18:15–18:30 | **Entregar URL + repo.** No tocar más el servidor. |

> El deploy temprano es lo más importante: "sin proyecto online no hay evaluación".

## Recordar sobre la IA (25% de la nota)

- La key de OpenAI es compartida: va **solo** en el `.env` del servidor y nunca en el repo.
- Poné límites de uso. Abusar del consumo descalifica.
- Que la IA haga algo central para el problema: clasificar, priorizar, redactar, recomendar.
- Pedí salida JSON y validala. Mostrá errores claros si la IA falla.

## Entrega

- [ ] La URL pública abre desde otra red (celular con datos móviles).
- [ ] El repo es público o tiene acceso para el jurado.
- [ ] `git log` muestra commits durante el evento.
- [ ] Sin secretos en el repo: `git grep -n -i "sk-\|api_key=."`.
- [ ] README con problema, solución, cómo funciona la IA y la URL.

## Presentación (10%)

1. Problema en una frase. 2. Demo en vivo del flujo principal. 3. Qué hace la IA y por qué aporta. 4. Arquitectura en una línea.
