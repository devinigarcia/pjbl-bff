import { z } from 'zod';

// Variável vazia no .env ("FUNCTION_URL=") conta como "não definida".
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().trim().url().optional());
const urlWithDefault = (fallback: string) =>
  z.preprocess(emptyToUndefined, z.string().trim().url().default(fallback));
const intWithDefault = (fallback: number, min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(fallback));

const envSchema = z.object({
  PORT: intWithDefault(3000, 1, 65535),
  PRODUTOS_API_URL: urlWithDefault('http://localhost:3001'),
  PRODUTOS_API_KEY: optionalText,
  PEDIDOS_API_URL: urlWithDefault('http://localhost:3002'),
  PEDIDOS_API_KEY: optionalText,
  FUNCTION_URL: optionalUrl,
  FUNCTION_KEY: optionalText,
  GATEWAY_SECRET: optionalText,
  GATEWAY_URL: optionalUrl,
  CORS_ORIGIN: z.preprocess(emptyToUndefined, z.string().trim().default('*')),
  RATE_LIMIT_PER_MINUTE: intWithDefault(300, 1, 100000),
  UPSTREAM_TIMEOUT_MS: intWithDefault(10000, 100, 120000),
  TRUST_PROXY: intWithDefault(1, 0, 10),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  PUBLIC_URL: optionalUrl,
});

export interface Config {
  port: number;
  produtosApiUrl: string;
  produtosApiKey?: string;
  pedidosApiUrl: string;
  pedidosApiKey?: string;
  /** URL base da Function App, já com /api (ex.: https://func-x.azurewebsites.net/api). */
  functionUrl?: string;
  functionKey?: string;
  gatewaySecret?: string;
  gatewayUrl?: string;
  corsOrigins: string[] | '*';
  rateLimitPerMinute: number;
  upstreamTimeoutMs: number;
  trustProxy: number;
  logLevel: string;
  publicUrl?: string;
}

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, '');

/** Lê e valida as variáveis de ambiente. Se algo estiver errado o serviço nem sobe. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuração inválida — ${problems}`);
  }
  const values = parsed.data;

  const origins = values.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port: values.PORT,
    produtosApiUrl: stripTrailingSlash(values.PRODUTOS_API_URL),
    produtosApiKey: values.PRODUTOS_API_KEY,
    pedidosApiUrl: stripTrailingSlash(values.PEDIDOS_API_URL),
    pedidosApiKey: values.PEDIDOS_API_KEY,
    functionUrl: values.FUNCTION_URL ? stripTrailingSlash(values.FUNCTION_URL) : undefined,
    functionKey: values.FUNCTION_KEY,
    gatewaySecret: values.GATEWAY_SECRET,
    gatewayUrl: values.GATEWAY_URL ? stripTrailingSlash(values.GATEWAY_URL) : undefined,
    corsOrigins: origins.includes('*') || origins.length === 0 ? '*' : origins,
    rateLimitPerMinute: values.RATE_LIMIT_PER_MINUTE,
    upstreamTimeoutMs: values.UPSTREAM_TIMEOUT_MS,
    trustProxy: values.TRUST_PROXY,
    logLevel: values.LOG_LEVEL,
    publicUrl: values.PUBLIC_URL ? stripTrailingSlash(values.PUBLIC_URL) : undefined,
  };
}

/** Carrega o arquivo .env se existir (só usado em desenvolvimento; na nuvem vêm variáveis de verdade). */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // sem .env, segue com o que já está no ambiente
  }
}
