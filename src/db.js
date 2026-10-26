import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  address      TEXT NOT NULL,
  neighborhood TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'otro',
  urgency      TEXT,
  status       TEXT NOT NULL DEFAULT 'nuevo',
  votes        INTEGER NOT NULL DEFAULT 0,
  ai_status    TEXT NOT NULL DEFAULT 'pendiente',
  ai_message   TEXT,
  ai_summary   TEXT,
  ai_area      TEXT,
  ai_draft     TEXT,
  ai_model     TEXT,
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at);

CREATE TABLE IF NOT EXISTS ai_usage (
  day   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL permite leer mientras se escribe; busy_timeout evita errores "database is locked".
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

export function createRepo(db) {
  const insert = db.prepare(`
    INSERT INTO reports (title, description, address, neighborhood, category, is_demo)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const byId = db.prepare('SELECT * FROM reports WHERE id = ?');

  return {
    ping() {
      return db.prepare('SELECT 1 AS ok').get().ok === 1;
    },

    create({ title, description, address, neighborhood, category }, isDemo = false) {
      const { lastInsertRowid } = insert.run(
        title, description, address, neighborhood ?? '', category ?? 'otro', isDemo ? 1 : 0,
      );
      return byId.get(Number(lastInsertRowid));
    },

    get(id) {
      return byId.get(id);
    },

    list({ category, status, q, sort } = {}) {
      const where = [];
      const params = [];
      if (category) { where.push('category = ?'); params.push(category); }
      if (status) { where.push('status = ?'); params.push(status); }
      if (q) {
        where.push('(title LIKE ? OR description LIKE ? OR address LIKE ? OR neighborhood LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like, like);
      }
      const order = sort === 'votes' ? 'votes DESC, created_at DESC' : 'created_at DESC';
      const sql = `SELECT * FROM reports ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY ${order} LIMIT 200`;
      return db.prepare(sql).all(...params);
    },

    saveAi(id, ai) {
      db.prepare(`
        UPDATE reports SET
          ai_status = ?, ai_message = ?, ai_summary = ?, ai_area = ?, ai_draft = ?, ai_model = ?,
          category = COALESCE(?, category), urgency = COALESCE(?, urgency), updated_at = ?
        WHERE id = ?`).run(
        ai.status, ai.message ?? null, ai.summary ?? null, ai.area ?? null, ai.draft ?? null,
        ai.model ?? null, ai.category ?? null, ai.urgency ?? null, now(), id,
      );
      return byId.get(id);
    },

    setStatus(id, status) {
      db.prepare('UPDATE reports SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
      return byId.get(id);
    },

    vote(id) {
      db.prepare('UPDATE reports SET votes = votes + 1 WHERE id = ?').run(id);
      return byId.get(id);
    },

    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM reports').get().n;
    },

    stats() {
      const group = (col) => Object.fromEntries(
        db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM reports GROUP BY ${col}`).all()
          .map((r) => [r.k ?? 'sin_dato', r.n]),
      );
      return {
        total: this.count(),
        byStatus: group('status'),
        byCategory: group('category'),
        byUrgency: group('urgency'),
      };
    },

    // Contador diario persistente: protege la API key compartida de un consumo excesivo.
    tryConsumeAi(limit) {
      const day = today();
      const row = db.prepare('SELECT count FROM ai_usage WHERE day = ?').get(day);
      if (row && row.count >= limit) return false;
      db.prepare(`INSERT INTO ai_usage (day, count) VALUES (?, 1)
                  ON CONFLICT(day) DO UPDATE SET count = count + 1`).run(day);
      return true;
    },

    aiUsageToday() {
      return db.prepare('SELECT count FROM ai_usage WHERE day = ?').get(today())?.count ?? 0;
    },
  };
}
