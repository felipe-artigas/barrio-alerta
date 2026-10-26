import { CATEGORIES, URGENCIES } from './validation.js';

export class AiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status; // 'no_configurada' | 'error' | 'limite'
  }
}

const SYSTEM_PROMPT = `Sos un asistente de atención ciudadana de la Municipalidad de Rosario (Argentina).
Recibís reclamos de vecinos y devolvés SOLO un objeto JSON con estas claves:
- "category": una de ${JSON.stringify(CATEGORIES)}
- "urgency": una de ${JSON.stringify(URGENCIES)}. "alta" si hay riesgo para personas (cables, pozos profundos, pérdidas de gas o agua importantes, semáforos apagados).
- "area": el área municipal que probablemente deba intervenir (texto corto, ej. "Secretaría de Obras Públicas").
- "summary": resumen del problema en una oración (máx. 200 caracteres).
- "draft": reclamo formal listo para enviar, en español rioplatense formal, de 80 a 160 palabras, con saludo, descripción, ubicación y pedido concreto. Sin inventar datos personales: usá "[Nombre y DNI]" como marcador.
Si el texto no describe un problema urbano, usá category "otro", urgency "baja" y explicalo en "summary".`;

export function createAiClient(config, fetchImpl = globalThis.fetch) {
  const configured = Boolean(config.openaiApiKey);
  const model = config.openaiModel;

  async function analyzeReport(report) {
    if (!configured) {
      throw new AiError('no_configurada', 'La IA no está configurada en el servidor (falta OPENAI_API_KEY).');
    }

    const userContent = [
      `Título: ${report.title}`,
      `Descripción: ${report.description}`,
      `Dirección: ${report.address}`,
      report.neighborhood ? `Barrio: ${report.neighborhood}` : null,
    ].filter(Boolean).join('\n');

    let res;
    try {
      res = await fetchImpl(`${config.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          max_completion_tokens: 1500,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
        }),
        signal: AbortSignal.timeout(config.aiTimeoutMs),
      });
    } catch (err) {
      const msg = err.name === 'TimeoutError'
        ? 'La IA tardó demasiado en responder.'
        : 'No se pudo conectar con el servicio de IA.';
      throw new AiError('error', msg);
    }

    if (!res.ok) {
      // Nunca se registra la key: solo el código HTTP.
      const hint = { 401: 'API key inválida', 404: 'modelo no disponible', 429: 'límite de uso alcanzado' }[res.status];
      throw new AiError('error', `El servicio de IA respondió ${res.status}${hint ? ` (${hint})` : ''}.`);
    }

    let parsed;
    try {
      const data = await res.json();
      parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '');
    } catch {
      throw new AiError('error', 'La IA devolvió una respuesta con formato inválido.');
    }
    return normalize(parsed);
  }

  // La IA puede equivocarse: se valida cada campo antes de guardarlo.
  function normalize(raw) {
    const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null);
    const summary = text(raw.summary, 300);
    const draft = text(raw.draft, 3000);
    if (!summary || !draft) throw new AiError('error', 'La respuesta de la IA está incompleta.');
    return {
      category: CATEGORIES.includes(raw.category) ? raw.category : 'otro',
      urgency: URGENCIES.includes(raw.urgency) ? raw.urgency : 'media',
      area: text(raw.area, 120) ?? 'A determinar',
      summary,
      draft,
      model,
    };
  }

  return { configured, model, analyzeReport };
}
