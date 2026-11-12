import type { z } from 'zod';
import { ValidationError } from '../domain/errors';

/** Valida a entrada com o schema da feature e devolve o valor já tipado. */
export function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'body',
      message: issue.message,
    })),
  );
}

export type QueryParams = Record<string, string>;

/**
 * Deixa passar só os parâmetros de consulta que a rota conhece.
 * Evita repassar qualquer coisa que o cliente inventar para os microserviços.
 */
export function pickQuery(source: unknown, allowed: readonly string[]): QueryParams {
  const picked: QueryParams = {};
  if (typeof source !== 'object' || source === null) return picked;

  for (const key of allowed) {
    const raw = (source as Record<string, unknown>)[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && value.trim() !== '') {
      picked[key] = value.trim();
    }
  }
  return picked;
}
