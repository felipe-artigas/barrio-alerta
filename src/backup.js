// Copia consistente de SQLite con VACUUM INTO (segura aunque la app esté corriendo).
// Uso: npm run backup   |   BACKUP_DIR y BACKUP_KEEP opcionales.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const { config } = loadConfig();
const dir = process.env.BACKUP_DIR ?? path.join(path.dirname(path.resolve(config.dbPath)), 'backups');
const keep = Number.parseInt(process.env.BACKUP_KEEP ?? '7', 10);

mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(dir, `barrio-alerta-${stamp}.sqlite`);

const db = openDb(config.dbPath);
db.prepare('VACUUM INTO ?').run(target);
db.close();
console.log(`Backup creado: ${target}`);

const old = readdirSync(dir).filter((f) => f.startsWith('barrio-alerta-') && f.endsWith('.sqlite')).sort().reverse().slice(keep);
for (const f of old) {
  rmSync(path.join(dir, f));
  console.log(`Backup antiguo eliminado: ${f}`);
}
