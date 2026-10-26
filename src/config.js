import { existsSync } from 'node:fs';

// En desarrollo se lee .env; en producción systemd inyecta las variables (EnvironmentFile).
if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig() {
  const config = {
    nodeEnv: env.NODE_ENV ?? 'development',
    host: env.HOST ?? '127.0.0.1',
    port: int(env.PORT, 3000),
    dbPath: env.DB_PATH ?? './data/barrio-alerta.sqlite',
    adminToken: env.ADMIN_TOKEN ?? '',
    trustProxy: int(env.TRUST_PROXY, 0),
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL ?? 'gpt-4o-mini',
    openaiBaseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    aiTimeoutMs: int(env.AI_TIMEOUT_MS, 20000),
    aiDailyLimit: int(env.AI_DAILY_LIMIT, 200),
    seedDemo: env.SEED_DEMO === 'true',
  };

  const problems = [];
  if (config.nodeEnv === 'production' && config.adminToken.length < 16) {
    problems.push('ADMIN_TOKEN debe tener al menos 16 caracteres en producción.');
  }
  if (config.port < 1 || config.port > 65535) problems.push(`PORT inválido: ${env.PORT}`);

  return { config, problems };
}
