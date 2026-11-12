import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { sendError } from '../http';

const OPEN_PATHS = new Set(['/', '/health', '/openapi.json']);

const isOpenPath = (path: string) => OPEN_PATHS.has(path) || path === '/docs' || path.startsWith('/docs/');

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Quando GATEWAY_SECRET está definido, o BFF só atende quem chega com o cabeçalho
 * x-gateway-secret correto — e quem coloca esse cabeçalho é a policy do API Gateway.
 * Na prática isso obriga todo mundo a entrar pelo gateway, mesmo sabendo a URL do BFF.
 *
 * Ficam de fora: health check, Swagger e o preflight de CORS (OPTIONS não leva cabeçalho customizado).
 */
export function gatewaySecret(secret: string | undefined): RequestHandler {
  if (!secret) {
    return (_req, _res, next) => next();
  }
  const expected = digest(secret);

  return (req, res, next) => {
    if (req.method === 'OPTIONS' || isOpenPath(req.path)) {
      next();
      return;
    }

    const provided = req.header('x-gateway-secret');
    // compara os hashes para a comparação levar sempre o mesmo tempo
    if (provided && timingSafeEqual(digest(provided), expected)) {
      next();
      return;
    }

    sendError(res, 401, 'UNAUTHORIZED', 'Acesso permitido somente pelo API Gateway.');
  };
}
