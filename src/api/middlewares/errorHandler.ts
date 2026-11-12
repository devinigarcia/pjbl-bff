import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError, ConflictError, DomainError, UpstreamError, ValidationError } from '../../domain/errors';
import { sendError } from '../http';

/** Rota que não existe. */
export function notFound(): RequestHandler {
  return (req, res) => {
    sendError(res, 404, 'ROUTE_NOT_FOUND', `Rota ${req.method} ${req.path} não existe no BFF.`);
  };
}

/**
 * Único lugar que traduz erro em resposta HTTP.
 * As camadas de dentro só lançam exceções; aqui decidimos o status.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    if (error instanceof ValidationError) {
      sendError(res, 400, error.code, error.message, error.issues);
      return;
    }

    if (error instanceof UpstreamError) {
      if (error.failure === 'rejected') {
        // 4xx do microserviço: repassa como veio (mesmo status, código e detalhes).
        sendError(res, error.status ?? 400, error.code, error.message, error.details);
        return;
      }
      sendError(res, error.failure === 'timeout' ? 504 : 502, error.code, error.message, { service: error.service });
      return;
    }

    if (error instanceof ConflictError) {
      sendError(res, 409, error.code, error.message, error.details);
      return;
    }

    if (error instanceof DomainError) {
      sendError(res, 422, error.code, error.message, error.details);
      return;
    }

    if (error instanceof AppError) {
      sendError(res, 400, error.code, error.message, error.details);
      return;
    }

    // Erros do body-parser do Express (JSON quebrado, corpo grande demais).
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') {
      sendError(res, 400, 'INVALID_JSON', 'O corpo da requisição não é um JSON válido.');
      return;
    }
    if (type === 'entity.too.large') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'O corpo da requisição é grande demais.');
      return;
    }

    logger.error(
      { err: error, method: req.method, path: req.path, correlationId: res.locals.correlationId },
      'erro inesperado no BFF',
    );
    sendError(res, 500, 'INTERNAL_ERROR', 'Erro interno no BFF. Tente novamente em instantes.');
  };
}
