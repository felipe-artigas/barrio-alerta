import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDb, createRepo } from './db.js';
import { createAiClient, AiError } from './ai.js';
import { rateLimit } from './rateLimit.js';
import { validateReport, parseId, CATEGORIES, STATUSES, URGENCIES } from './validation.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(config, deps = {}) {
  const db = deps.db ?? openDb(config.dbPath);
  const repo = createRepo(db);
  const ai = deps.ai ?? createAiClient(config);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy); // 1 detrás de Nginx: req.ip = IP real del visitante
  app.use(securityHeaders);
  app.use(express.json({ limit: '20kb' }));

  const writeLimit = rateLimit({ windowMs: 10 * 60_000, max: 20, message: 'Demasiadas acciones seguidas. Probá de nuevo en unos minutos.' });
  const aiLimit = rateLimit({ windowMs: 10 * 60_000, max: 8, message: 'Demasiados análisis con IA seguidos. Esperá unos minutos.' });

  // Analiza con IA y guarda el resultado. Nunca lanza: un fallo de la IA no rompe el reclamo.
  async function analyzeAndSave(report) {
    try {
      if (!ai.configured) throw new AiError('no_configurada', 'La IA no está configurada en el servidor (falta OPENAI_API_KEY).');
      if (!repo.tryConsumeAi(config.aiDailyLimit)) throw new AiError('limite', 'Se alcanzó el límite diario de análisis con IA.');
      const result = await ai.analyzeReport(report);
      return repo.saveAi(report.id, { status: 'ok', ...result });
    } catch (err) {
      if (!(err instanceof AiError)) console.error('Error inesperado en IA:', err);
      else if (err.status === 'error') console.warn(`IA falló para reclamo ${report.id}: ${err.message}`);
      return repo.saveAi(report.id, {
        status: err instanceof AiError ? err.status : 'error',
        message: err instanceof AiError ? err.message : 'Error inesperado al analizar.',
      });
    }
  }

  function findReport(req, res) {
    const id = parseId(req.params.id);
    const report = id && repo.get(id);
    if (!report) res.status(404).json({ error: 'Reclamo no encontrado.' });
    return report;
  }

  function requireAdmin(req, res, next) {
    const token = req.get('X-Admin-Token') ?? '';
    if (!config.adminToken || !safeEqual(token, config.adminToken)) {
      return res.status(401).json({ error: 'Token de operador inválido o ausente.' });
    }
    next();
  }

  app.get('/api/health', (req, res) => {
    let dbOk = false;
    try { dbOk = repo.ping(); } catch (err) { console.error('Health: base de datos con error:', err.message); }
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degradado',
      db: dbOk,
      ai: { configured: ai.configured, model: ai.configured ? ai.model : null },
      uptimeSeconds: Math.round(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  });

  app.get('/api/meta', (req, res) => {
    res.json({ categories: CATEGORIES, statuses: STATUSES, urgencies: URGENCIES });
  });

  app.get('/api/reports', (req, res) => {
    const pick = (v, allowed) => (typeof v === 'string' && allowed.includes(v) ? v : undefined);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : undefined;
    res.json(repo.list({
      category: pick(req.query.category, CATEGORIES),
      status: pick(req.query.status, STATUSES),
      sort: pick(req.query.sort, ['recent', 'votes']),
      q: q || undefined,
    }));
  });

  app.get('/api/reports/:id', (req, res) => {
    const report = findReport(req, res);
    if (report) res.json(report);
  });

  app.post('/api/reports', writeLimit, aiLimit, async (req, res) => {
    const { errors, value } = validateReport(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Revisá los datos del formulario.', fields: errors });
    const report = repo.create(value); // se guarda primero: los datos no dependen de la IA
    res.status(201).json(await analyzeAndSave(report));
  });

  app.post('/api/reports/:id/analyze', aiLimit, async (req, res) => {
    const report = findReport(req, res);
    if (report) res.json(await analyzeAndSave(report));
  });

  app.post('/api/reports/:id/vote', writeLimit, (req, res) => {
    const report = findReport(req, res);
    if (report) res.json(repo.vote(report.id));
  });

  app.patch('/api/reports/:id/status', requireAdmin, (req, res) => {
    const report = findReport(req, res);
    if (!report) return;
    const status = req.body?.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `Estado inválido. Valores posibles: ${STATUSES.join(', ')}.` });
    res.json(repo.setStatus(report.id, status));
  });

  app.get('/api/stats', (req, res) => {
    res.json({ ...repo.stats(), aiUsedToday: repo.aiUsageToday(), aiDailyLimit: config.aiDailyLimit });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta de API inexistente.' }));
  app.use(express.static(publicDir, { maxAge: '1h' }));

  // Manejador final: JSON mal formado, cuerpo demasiado grande o errores no previstos.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El contenido es demasiado grande.' });
    console.error('Error no controlado:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return { app, db, repo };
}
