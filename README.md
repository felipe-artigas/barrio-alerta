# Barrio Alerta

Aplicación web para reportar problemas urbanos (baches, alumbrado, residuos, arbolado…).
Una IA **clasifica** cada reclamo, estima su **urgencia**, sugiere el **área municipal** responsable
y **redacta el reclamo formal** listo para enviar.

> Proyecto de práctica para la Hackatón DonWeb Day Rosario 2026. Los datos son ficticios.

**URL pública:** https://138-36-237-99.sslip.io · **Repositorio:** https://github.com/felipe-artigas/barrio-alerta

## Problema

Los vecinos no saben a qué área reclamar ni cómo redactar un reclamo formal, y los problemas
repetidos no se priorizan. Barrio Alerta centraliza los reportes, permite apoyarlos ("me pasa también")
y entrega a los operadores municipales una lista ordenada por urgencia y apoyos.

**Usuarios:** vecinos (reportan y apoyan) y operadores municipales (cambian el estado con un token).

## Funcionalidades

- Alta de reclamos con validación en cliente y servidor.
- Análisis con IA (OpenAI, desde el backend): categoría, urgencia, área sugerida, resumen y reclamo formal.
- La app **funciona sin IA**: si no hay key o la API falla, el reclamo se guarda igual y se puede reanalizar después. Nunca se inventan resultados.
- Listado con búsqueda, filtros por categoría y estado, y orden por recientes o más apoyados.
- Apoyos de vecinos, estadísticas y modo operador protegido por token.
- Límites contra abuso: por IP (escrituras y análisis) y un tope diario persistente de usos de IA.
- Diseño responsive con modo oscuro automático.

## Arquitectura

```
Navegador ──HTTPS──▶ Nginx :80/:443 ──proxy──▶ Node.js + Express (127.0.0.1:3000)
                                                  ├─ SQLite (node:sqlite) en /var/lib/barrio-alerta
                                                  └─ fetch ──▶ API de OpenAI (opcional)
systemd: reinicio automático · UFW: solo SSH/80/443 · cron: backup diario
```

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend | HTML + CSS + JS (sin build) | Cero dependencias y nada que compilar |
| Backend | Node.js 24 + Express 5 | Una sola dependencia |
| Base de datos | SQLite (`node:sqlite`, incluido en Node) | Sin servidor extra ni compilación nativa |
| IA | OpenAI Chat Completions con salida JSON | Solo desde el backend: la key no llega al navegador |
| Producción | Ubuntu + Nginx + systemd + UFW + Certbot | Liviano para 2 GB de RAM |

### Estructura

```
src/
  server.js      arranque, señales, errores de puerto
  app.js         rutas de la API, seguridad, manejo de errores
  db.js          esquema SQLite y consultas
  ai.js          cliente de OpenAI + validación de la respuesta
  validation.js  reglas de entrada
  rateLimit.js   límite de peticiones por IP
  seed.js        datos de demostración
  backup.js      backup con VACUUM INTO
public/          frontend
test/            pruebas (node:test)
deploy/          scripts y configuración de servidor
docs/            despliegue, diagnóstico y checklist
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servicio, la DB y la IA |
| GET | `/api/meta` | Categorías, estados y urgencias válidas |
| GET | `/api/reports?q=&category=&status=&sort=recent\|votes` | Listado |
| GET | `/api/reports/:id` | Detalle |
| POST | `/api/reports` | Crear (y analizar con IA) |
| POST | `/api/reports/:id/analyze` | Reintentar el análisis con IA |
| POST | `/api/reports/:id/vote` | Sumar apoyo |
| PATCH | `/api/reports/:id/status` | Cambiar estado (header `X-Admin-Token`) |
| GET | `/api/stats` | Estadísticas |

## Ejecutar localmente

Requisitos: Node.js 22.13 o superior (recomendado 24) y Git.

```powershell
npm install
copy .env.example .env      # completar ADMIN_TOKEN y, si tenés, OPENAI_API_KEY
npm run dev                 # http://127.0.0.1:3000 (se reinicia al guardar)
npm test
```

### Variables de entorno

Ver [.env.example](.env.example). Las importantes: `ADMIN_TOKEN` (obligatoria en producción, mínimo 16
caracteres), `OPENAI_API_KEY` (opcional), `OPENAI_MODEL`, `AI_DAILY_LIMIT`, `DB_PATH` y `TRUST_PROXY=1` detrás de Nginx.

## Despliegue

Guía paso a paso: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md). En resumen, en el servidor y como root:

```bash
git clone https://github.com/felipe-artigas/barrio-alerta.git /root/barrio-alerta
bash /root/barrio-alerta/deploy/setup-server.sh            # paquetes, Node, usuario, firewall, Nginx
bash /root/barrio-alerta/deploy/remote-install.sh /root/barrio-alerta   # app + systemd + Nginx
bash /root/barrio-alerta/deploy/enable-https.sh            # HTTPS con <ip>.sslip.io
```

Diagnóstico de problemas: [docs/DIAGNOSTICO.md](docs/DIAGNOSTICO.md).

## Pruebas

`npm test` ejecuta 17 pruebas con el runner nativo de Node: validación, endpoints, autorización, límites,
manejo de errores y el cliente de IA (con respuestas simuladas **solo dentro de los tests**).

## Limitaciones conocidas

- El límite por IP vive en memoria: se reinicia con el proceso y no sirve para varios servidores.
- El modo operador usa un único token compartido, sin cuentas de usuario.
- Los apoyos no se deduplican por persona (solo están limitados por IP).
- Sin mapa ni fotos adjuntas.

## Mejoras futuras

- Detección de reclamos duplicados con embeddings.
- Mapa con geolocalización y subida de fotos (análisis de imagen con IA).
- Cuentas de operador y registro de cambios de estado.
- Notificaciones por email al cambiar el estado.
