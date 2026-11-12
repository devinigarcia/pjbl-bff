// Erros do BFF. Ficam no domínio porque as camadas de dentro precisam lançá-los
// sem saber nada de HTTP — quem traduz para status code é o errorHandler da API.

export interface FieldIssue {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Entrada inválida (vira 400). */
export class ValidationError extends AppError {
  constructor(
    public readonly issues: FieldIssue[],
    message = 'Dados inválidos.',
  ) {
    super('VALIDATION_ERROR', message, issues);
  }
}

/** Regra de negócio quebrada (vira 422). */
export class DomainError extends AppError {}

/** Conflito com o estado atual, por exemplo estoque insuficiente (vira 409). */
export class ConflictError extends AppError {}

export type UpstreamFailure = 'rejected' | 'unavailable' | 'timeout';

/**
 * Problema ao falar com um serviço de trás (ms-produtos, ms-pedidos ou a Function).
 *
 * - `rejected`: o serviço respondeu 4xx — é um erro "de verdade" do cliente e a gente repassa como veio.
 * - `unavailable`: caiu, devolveu 5xx ou recusou a nossa credencial — vira 502.
 * - `timeout`: demorou mais que o limite — vira 504.
 */
export class UpstreamError extends AppError {
  private constructor(
    public readonly service: string,
    public readonly failure: UpstreamFailure,
    public readonly status: number | null,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(code, message, details);
  }

  static rejected(service: string, status: number, code: string, message: string, details?: unknown): UpstreamError {
    return new UpstreamError(service, 'rejected', status, code, message, details);
  }

  static unavailable(service: string, reason: string, status: number | null = null): UpstreamError {
    return new UpstreamError(
      service,
      'unavailable',
      status,
      'UPSTREAM_UNAVAILABLE',
      `O serviço ${service} está indisponível no momento (${reason}).`,
    );
  }

  static timeout(service: string, timeoutMs: number): UpstreamError {
    return new UpstreamError(
      service,
      'timeout',
      null,
      'UPSTREAM_TIMEOUT',
      `O serviço ${service} não respondeu em ${timeoutMs} ms.`,
    );
  }
}
