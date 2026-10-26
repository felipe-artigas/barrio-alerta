export const CATEGORIES = [
  'bache',
  'alumbrado',
  'residuos',
  'arbolado',
  'agua_cloacas',
  'transito',
  'espacio_verde',
  'otro',
];
export const URGENCIES = ['baja', 'media', 'alta'];
export const STATUSES = ['nuevo', 'en_proceso', 'resuelto'];

// Quita caracteres de control (salvo saltos de línea) y espacios sobrantes.
function clean(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
}

const RULES = {
  title: { label: 'El título', required: 'obligatorio', min: 5, max: 120 },
  description: { label: 'La descripción', required: 'obligatoria', min: 20, max: 2000 },
  address: { label: 'La dirección', required: 'obligatoria', min: 3, max: 160 },
  neighborhood: { label: 'El barrio', required: null, min: 0, max: 80 },
};

export function validateReport(body) {
  const errors = {};
  const value = {};
  if (!body || typeof body !== 'object') {
    return { errors: { body: 'Se esperaba un objeto JSON.' }, value };
  }

  for (const [field, rule] of Object.entries(RULES)) {
    const text = clean(body[field]);
    if (rule.required && !text) errors[field] = `${rule.label} es ${rule.required}.`;
    else if (text && text.length < rule.min) errors[field] = `${rule.label} debe tener al menos ${rule.min} caracteres.`;
    else if (text.length > rule.max) errors[field] = `${rule.label} admite como máximo ${rule.max} caracteres.`;
    value[field] = text;
  }

  const category = clean(body.category);
  if (category && !CATEGORIES.includes(category)) errors.category = 'Categoría no válida.';
  value.category = category || null;

  return { errors, value };
}

export function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
