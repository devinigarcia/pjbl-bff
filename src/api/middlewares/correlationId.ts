import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const VALID_ID = /^[\w.:-]{8,100}$/;

/**
 * Garante que toda requisição tenha um x-correlation-id.
 * Se o front (ou o gateway) já mandou um, reaproveita; senão cria um UUID.
 * O mesmo id segue para os microserviços e para a Function, então dá para
 * acompanhar uma chamada inteira pelos logs de todos os serviços.
 */
export function correlationId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header('x-correlation-id');
    const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();

    res.locals.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  };
}
