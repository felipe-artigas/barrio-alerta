import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { seedDemo } from './seed.js';

const { config, problems } = loadConfig();
if (problems.length) {
  console.error('Configuración inválida:\n- ' + problems.join('\n- '));
  process.exit(1);
}

let created;
try {
  created = createApp(config);
} catch (err) {
  console.error(`No se pudo abrir la base de datos en ${config.dbPath}: ${err.message}`);
  process.exit(1);
}
const { app, db, repo } = created;

if (config.seedDemo && repo.count() === 0) {
  console.log(`Base vacía: se cargaron ${seedDemo(repo)} reclamos de demostración.`);
}

const server = app.listen(config.port, config.host, () => {
  console.log(`Barrio Alerta escuchando en http://${config.host}:${config.port} (${config.nodeEnv})`);
  console.log(`IA: ${config.openaiApiKey ? `configurada (${config.openaiModel})` : 'NO configurada, la app funciona sin análisis'}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`El puerto ${config.port} ya está en uso. ¿Hay otra instancia corriendo?`);
  else console.error('Error del servidor HTTP:', err);
  process.exit(1);
});

// systemd envía SIGTERM al detener/reiniciar: cerramos ordenadamente.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} recibido, cerrando...`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
