import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createAiClient } from '../src/ai.js';
import { validateReport } from '../src/validation.js';

const baseConfig = {
  dbPath: ':memory:',
  adminToken: 'token-de-prueba-123456',
  trustProxy: 0,
  openaiApiKey: '',
  openaiModel: 'modelo-test',
  openaiBaseUrl: 'http://ia.invalid/v1',
  aiTimeoutMs: 1000,
  aiDailyLimit: 2,
};

const servers = [];
async function start(overrides = {}, deps = {}) {
  const { app, db } = createApp({ ...baseConfig, ...overrides }, deps);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push({ server, db });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };
  return call;
}
after(() => {
  for (const { server, db } of servers) { server.closeAllConnections(); server.close(); db.close(); }
});

const valid = {
  title: 'Bache en la esquina',
  description: 'Hay un pozo enorme que ya rompió varias ruedas de autos.',
  address: 'Córdoba 1200',
  neighborhood: 'Centro',
};

// Respuesta falsa de la API de OpenAI, solo para pruebas.
function fakeFetch(payload, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status });
  };
  fn.calls = calls;
  return fn;
}

describe('validación', () => {
  test('acepta un reclamo válido y limpia espacios', () => {
    const { errors, value } = validateReport({ ...valid, title: '  Bache en la esquina  ' });
    assert.deepEqual(errors, {});
    assert.equal(value.title, 'Bache en la esquina');
  });
  test('rechaza campos cortos, largos y categoría inválida', () => {
    const { errors } = validateReport({ title: 'abc', description: 'corta', address: '', category: 'ovni' });
    assert.ok(errors.title && errors.description && errors.address && errors.category);
    assert.ok(validateReport({ ...valid, title: 'x'.repeat(121) }).errors.title);
  });
});

describe('API sin IA configurada', async () => {
  const call = await start();

  test('health responde ok e indica IA no configurada', async () => {
    const r = await call('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.db, true);
    assert.equal(r.body.ai.configured, false);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });

  test('crea un reclamo y lo guarda aunque no haya IA', async () => {
    const r = await call('/api/reports', { method: 'POST', body: { ...valid, category: 'bache' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.title, valid.title);
    assert.equal(r.body.category, 'bache');
    assert.equal(r.body.ai_status, 'no_configurada');
    assert.equal(r.body.ai_draft, null); // nunca se inventa un resultado de IA

    const got = await call(`/api/reports/${r.body.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.description, valid.description);
  });

  test('devuelve 400 con detalle por campo', async () => {
    const r = await call('/api/reports', { method: 'POST', body: { title: 'x' } });
    assert.equal(r.status, 400);
    assert.ok(r.body.fields.title);
    assert.ok(r.body.fields.description);
  });

  test('JSON mal formado devuelve 400', async () => {
    const r = await call('/api/reports', { method: 'POST', body: '{malo' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'JSON mal formado.');
  });

  test('lista, filtra y busca', async () => {
    await call('/api/reports', { method: 'POST', body: { ...valid, title: 'Luz apagada en plaza', category: 'alumbrado' } });
    const all = await call('/api/reports');
    assert.ok(all.body.length >= 2);
    const luz = await call('/api/reports?category=alumbrado');
    assert.ok(luz.body.every((r) => r.category === 'alumbrado'));
    const q = await call('/api/reports?q=plaza');
    assert.equal(q.body.length, 1);
    const ignored = await call('/api/reports?category=ovni');
    assert.equal(ignored.body.length, all.body.length);
  });

  test('votar suma apoyos; id inexistente da 404', async () => {
    const created = await call('/api/reports', { method: 'POST', body: valid });
    const v = await call(`/api/reports/${created.body.id}/vote`, { method: 'POST' });
    assert.equal(v.body.votes, 1);
    assert.equal((await call('/api/reports/99999/vote', { method: 'POST' })).status, 404);
    assert.equal((await call('/api/reports/abc')).status, 404);
  });

  test('cambiar estado exige token de operador', async () => {
    const created = await call('/api/reports', { method: 'POST', body: valid });
    const path = `/api/reports/${created.body.id}/status`;
    assert.equal((await call(path, { method: 'PATCH', body: { status: 'resuelto' } })).status, 401);
    assert.equal((await call(path, { method: 'PATCH', body: { status: 'resuelto' }, headers: { 'X-Admin-Token': 'otro' } })).status, 401);
    const bad = await call(path, { method: 'PATCH', body: { status: 'cerrado' }, headers: { 'X-Admin-Token': baseConfig.adminToken } });
    assert.equal(bad.status, 400);
    const ok = await call(path, { method: 'PATCH', body: { status: 'resuelto' }, headers: { 'X-Admin-Token': baseConfig.adminToken } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'resuelto');
  });

  test('estadísticas y rutas inexistentes', async () => {
    const s = await call('/api/stats');
    assert.ok(s.body.total >= 1);
    assert.equal(typeof s.body.byCategory, 'object');
    assert.equal((await call('/api/nada')).status, 404);
  });

  test('sirve el frontend', async () => {
    const r = await call('/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
  });
});

describe('API con IA (respuesta simulada en tests)', async () => {
  const fetchImpl = fakeFetch({
    category: 'bache', urgency: 'alta', area: 'Obras Públicas',
    summary: 'Pozo profundo que daña vehículos.', draft: 'Me dirijo a ustedes para...',
  });
  const config = { ...baseConfig, openaiApiKey: 'sk-test' };
  const call = await start(config, { ai: createAiClient(config, fetchImpl) });

  test('guarda clasificación, urgencia y borrador de la IA', async () => {
    const r = await call('/api/reports', { method: 'POST', body: valid });
    assert.equal(r.status, 201);
    assert.equal(r.body.ai_status, 'ok');
    assert.equal(r.body.category, 'bache');
    assert.equal(r.body.urgency, 'alta');
    assert.equal(r.body.ai_area, 'Obras Públicas');
    assert.match(fetchImpl.calls[0].url, /\/chat\/completions$/);
    assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer sk-test');
  });

  test('respeta el límite diario de uso de IA', async () => {
    await call('/api/reports', { method: 'POST', body: valid }); // 2.º uso (límite = 2)
    const r = await call('/api/reports', { method: 'POST', body: valid });
    assert.equal(r.status, 201); // el reclamo se guarda igual
    assert.equal(r.body.ai_status, 'limite');
    assert.equal(fetchImpl.calls.length, 2);
  });
});

describe('cliente de IA', () => {
  const config = { ...baseConfig, openaiApiKey: 'sk-test' };

  test('normaliza valores fuera de lista', async () => {
    const ai = createAiClient(config, fakeFetch({ category: 'ovni', urgency: 'altísima', summary: 's', draft: 'd' }));
    const r = await ai.analyzeReport(valid);
    assert.equal(r.category, 'otro');
    assert.equal(r.urgency, 'media');
  });

  test('error HTTP de la API se informa sin exponer la key', async () => {
    const ai = createAiClient(config, async () => new Response('{}', { status: 401 }));
    await assert.rejects(ai.analyzeReport(valid), (err) => {
      assert.equal(err.status, 'error');
      assert.match(err.message, /401/);
      assert.doesNotMatch(err.message, /sk-test/);
      return true;
    });
  });

  test('timeout o red caída se informa como error', async () => {
    const ai = createAiClient(config, async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); });
    await assert.rejects(ai.analyzeReport(valid), /tardó demasiado/);
  });

  test('respuesta no JSON se rechaza', async () => {
    const ai = createAiClient(config, async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hola' } }] })));
    await assert.rejects(ai.analyzeReport(valid), /formato inválido/);
  });
});
