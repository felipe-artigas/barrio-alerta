const LABELS = {
  bache: 'Bache', alumbrado: 'Alumbrado', residuos: 'Residuos', arbolado: 'Arbolado',
  agua_cloacas: 'Agua y cloacas', transito: 'Tránsito', espacio_verde: 'Espacio verde', otro: 'Otro',
  nuevo: 'Nuevo', en_proceso: 'En proceso', resuelto: 'Resuelto',
  baja: 'Baja', media: 'Media', alta: 'Alta',
};
const label = (k) => LABELS[k] ?? k;
const $ = (sel) => document.querySelector(sel);

// Pequeño helper para crear nodos sin innerHTML (evita inyección de HTML/XSS).
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (admin) headers['X-Admin-Token'] = sessionStorage.getItem('adminToken') ?? '';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  } catch {
    throw Object.assign(new Error('No hay conexión con el servidor.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Error ${res.status}`), { status: res.status, data });
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast${isError ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

/* ---------- Estado general ---------- */

async function loadHealth() {
  const badge = $('#ai-badge');
  try {
    const h = await api('/api/health');
    if (h.ai.configured) { badge.textContent = 'IA activa'; badge.className = 'badge badge-ok'; }
    else { badge.textContent = 'IA no configurada'; badge.className = 'badge badge-warn'; }
  } catch {
    badge.textContent = 'Servidor sin respuesta';
    badge.className = 'badge badge-warn';
  }
}

async function loadStats() {
  try {
    const s = await api('/api/stats');
    const values = { total: s.total, ...s.byStatus, alta: s.byUrgency.alta ?? 0 };
    for (const node of document.querySelectorAll('[data-stat]')) node.textContent = values[node.dataset.stat] ?? 0;
  } catch { /* las estadísticas no son críticas */ }
}

async function loadMeta() {
  const meta = await api('/api/meta');
  const fill = (select, items) => select.append(...items.map((v) => el('option', { value: v }, label(v))));
  fill($('#report-form').category, meta.categories);
  fill($('#f-category'), meta.categories);
  fill($('#f-status'), meta.statuses);
  return meta;
}

/* ---------- Listado ---------- */

function reportItem(r) {
  return el('li', {},
    el('button', { class: 'report', type: 'button', onclick: () => openDetail(r.id) },
      el('div', { class: 'report-top' },
        el('h3', {}, r.title),
        el('span', { class: 'votes', title: 'Vecinos que apoyan' }, `▲ ${r.votes}`)),
      el('p', {}, `${r.address}${r.neighborhood ? ` · ${r.neighborhood}` : ''}`),
      el('div', { class: 'chips' },
        el('span', { class: 'chip' }, label(r.category)),
        el('span', { class: `chip chip-${r.status}` }, label(r.status)),
        r.urgency && el('span', { class: `chip chip-${r.urgency}` }, `Urgencia ${label(r.urgency).toLowerCase()}`),
        r.is_demo ? el('span', { class: 'chip' }, 'demo') : null)));
}

async function loadReports() {
  const params = new URLSearchParams();
  for (const [key, id] of [['q', '#f-q'], ['category', '#f-category'], ['status', '#f-status'], ['sort', '#f-sort']]) {
    const v = $(id).value.trim();
    if (v) params.set(key, v);
  }
  const state = $('#list-state');
  const list = $('#report-list');
  state.textContent = 'Cargando…';
  try {
    const reports = await api(`/api/reports?${params}`);
    list.replaceChildren(...reports.map(reportItem));
    state.textContent = reports.length ? '' : 'No hay reclamos con esos filtros.';
  } catch (err) {
    state.textContent = `No se pudieron cargar los reclamos: ${err.message}`;
  }
}

const refreshAll = () => Promise.all([loadReports(), loadStats()]);

/* ---------- Detalle ---------- */

function aiSection(r) {
  const box = el('div', { class: 'ai-box' }, el('h3', {}, 'Análisis con IA'));
  if (r.ai_status === 'ok') {
    box.append(
      el('dl', {},
        el('dt', {}, 'Resumen'), el('dd', {}, r.ai_summary),
        el('dt', {}, 'Urgencia'), el('dd', {}, label(r.urgency)),
        el('dt', {}, 'Área sugerida'), el('dd', {}, r.ai_area),
        el('dt', {}, 'Modelo'), el('dd', {}, r.ai_model)),
      el('strong', {}, 'Reclamo formal sugerido'),
      el('div', { class: 'draft' }, r.ai_draft),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => copy(r.ai_draft) }, 'Copiar reclamo')),
    );
  } else {
    box.append(el('p', { class: 'ai-msg' }, r.ai_message ?? 'Todavía no fue analizado.'));
  }
  if (r.ai_status !== 'no_configurada') {
    const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, r.ai_status === 'ok' ? 'Volver a analizar' : 'Analizar con IA');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Analizando…';
      try {
        const updated = await api(`/api/reports/${r.id}/analyze`, { method: 'POST' });
        renderDetail(updated);
        if (updated.ai_status !== 'ok') toast(updated.ai_message, true);
        refreshAll();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Analizar con IA';
      }
    });
    box.append(el('div', { class: 'actions' }, btn));
  }
  return box;
}

function adminSection(r) {
  if (!sessionStorage.getItem('adminToken')) return null;
  const select = el('select', { 'aria-label': 'Nuevo estado' },
    ...['nuevo', 'en_proceso', 'resuelto'].map((s) => el('option', { value: s, selected: s === r.status }, label(s))));
  const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Cambiar estado');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      renderDetail(await api(`/api/reports/${r.id}/status`, { method: 'PATCH', body: { status: select.value }, admin: true }));
      toast('Estado actualizado.');
      refreshAll();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });
  return el('div', { class: 'actions' }, el('strong', {}, 'Operador:'), select, btn);
}

function renderDetail(r) {
  const voteBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, `▲ Me pasa también (${r.votes})`);
  voteBtn.addEventListener('click', async () => {
    voteBtn.disabled = true;
    try {
      renderDetail(await api(`/api/reports/${r.id}/vote`, { method: 'POST' }));
      refreshAll();
    } catch (err) {
      toast(err.message, true);
      voteBtn.disabled = false;
    }
  });

  $('#detail-body').replaceChildren(
    el('h2', {}, r.title),
    el('div', { class: 'meta' }, `#${r.id} · ${r.address}${r.neighborhood ? ` · ${r.neighborhood}` : ''} · ${formatDate(r.created_at)}`),
    el('div', { class: 'chips' },
      el('span', { class: 'chip' }, label(r.category)),
      el('span', { class: `chip chip-${r.status}` }, label(r.status)),
      r.urgency && el('span', { class: `chip chip-${r.urgency}` }, `Urgencia ${label(r.urgency).toLowerCase()}`)),
    el('p', { class: 'desc' }, r.description),
    el('div', { class: 'actions' }, voteBtn),
    aiSection(r),
    adminSection(r),
  );
}

async function openDetail(id) {
  try {
    renderDetail(await api(`/api/reports/${id}`));
    const dialog = $('#detail');
    if (!dialog.open) dialog.showModal();
  } catch (err) {
    toast(err.message, true);
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Reclamo copiado al portapapeles.');
  } catch {
    toast('No se pudo copiar. Seleccioná el texto manualmente.', true);
  }
}

/* ---------- Formulario ---------- */

function setLoading(loading) {
  const btn = $('#submit-btn');
  btn.disabled = loading;
  btn.querySelector('.spinner').hidden = !loading;
  btn.querySelector('.btn-label').textContent = loading ? 'Guardando y analizando…' : 'Enviar reclamo';
}

function showFieldErrors(form, fields = {}) {
  for (const small of form.querySelectorAll('.field-error')) {
    const msg = fields[small.dataset.for] ?? '';
    small.textContent = msg;
    form.elements[small.dataset.for]?.classList.toggle('invalid', Boolean(msg));
  }
}

// Validación en el cliente (rápida) además de la del servidor (la que realmente protege).
function clientValidate(data) {
  const errors = {};
  if (data.title.length < 5) errors.title = 'El título debe tener al menos 5 caracteres.';
  if (data.description.length < 20) errors.description = 'La descripción debe tener al menos 20 caracteres.';
  if (data.address.length < 3) errors.address = 'La dirección es obligatoria.';
  return errors;
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));
  const errors = clientValidate(data);
  showFieldErrors(form, errors);
  if (Object.keys(errors).length) return;

  setLoading(true);
  try {
    const report = await api('/api/reports', { method: 'POST', body: data });
    form.reset();
    if (report.ai_status === 'ok') toast('Reclamo guardado y analizado por la IA.');
    else toast(`Reclamo guardado. ${report.ai_message ?? ''}`, report.ai_status === 'error');
    refreshAll();
    openDetail(report.id);
  } catch (err) {
    showFieldErrors(form, err.data?.fields);
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

/* ---------- Inicio ---------- */

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function init() {
  $('#report-form').addEventListener('submit', onSubmit);
  $('#refresh-btn').addEventListener('click', refreshAll);
  $('#f-q').addEventListener('input', debounce(loadReports, 300));
  for (const id of ['#f-category', '#f-status', '#f-sort']) $(id).addEventListener('change', loadReports);

  $('#admin-token').value = sessionStorage.getItem('adminToken') ?? '';
  $('#admin-save').addEventListener('click', () => {
    const v = $('#admin-token').value.trim();
    if (v) sessionStorage.setItem('adminToken', v); else sessionStorage.removeItem('adminToken');
    toast(v ? 'Token guardado para esta pestaña.' : 'Token eliminado.');
  });

  loadHealth();
  try {
    await loadMeta();
  } catch (err) {
    toast(`No se pudo iniciar: ${err.message}`, true);
  }
  refreshAll();
}

init();
