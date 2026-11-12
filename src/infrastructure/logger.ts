import pino, { type Logger } from 'pino';

/** Logger em JSON (pino). Cabeçalhos com segredo nunca vão para o log. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'pjbl-bff' },
    redact: {
      paths: [
        'req.headers["x-gateway-secret"]',
        'req.headers["x-api-key"]',
        'req.headers["x-functions-key"]',
        'req.headers["ocp-apim-subscription-key"]',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[oculto]',
    },
  });
}
