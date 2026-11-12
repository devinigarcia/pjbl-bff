import type { Response } from 'express';
import type { CallContext } from '../application/ports/CallContext';

/** Contexto da requisição atual (o correlation-id é colocado em res.locals pelo middleware). */
export function contextOf(res: Response): CallContext {
  return { correlationId: String(res.locals.correlationId ?? 'sem-correlation-id') };
}

/** Resposta de erro no formato padrão do projeto: { error: { code, message, details?, correlationId } }. */
export function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({
    error: {
      code,
      message,
      ...(details !== undefined && details !== null ? { details } : {}),
      correlationId: contextOf(res).correlationId,
    },
  });
}
