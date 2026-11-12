import type { Logger } from 'pino';
import { UpstreamError } from '../../domain/errors';

export interface HttpJsonClientOptions {
  /** Nome do serviço de destino, usado nos logs e nas mensagens de erro. */
  service: string;
  baseUrl: string;
  timeoutMs: number;
  /** Cabeçalhos fixos, como a chave interna do microserviço. */
  defaultHeaders?: Record<string, string>;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  correlationId: string;
  query?: Record<string, string>;
  body?: unknown;
}

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

/**
 * Cliente HTTP bem pequeno em cima do fetch nativo do Node.
 * Cuida do que é igual em toda chamada do BFF: timeout, correlation-id,
 * log com duração e tradução das falhas para UpstreamError.
 */
export class HttpJsonClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpJsonClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<T>(method: string, path: string, options: RequestOptions): Promise<T> {
    const { service, baseUrl, timeoutMs, defaultHeaders, logger } = this.options;

    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-correlation-id': options.correlationId,
      ...defaultHeaders,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const startedAt = Date.now();
    const logContext = { upstream: service, method, path, correlationId: options.correlationId };

    let status: number;
    let payload: unknown;
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      payload = await readBody(response);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      logger.warn({ ...logContext, durationMs, timedOut }, `chamada para ${service} falhou`);
      throw timedOut ? UpstreamError.timeout(service, timeoutMs) : UpstreamError.unavailable(service, 'falha de conexão');
    }

    logger.info({ ...logContext, status, durationMs: Date.now() - startedAt }, `chamada para ${service}`);

    if (status >= 200 && status < 300) {
      return payload as T;
    }
    throw this.toError(status, payload);
  }

  private toError(status: number, payload: unknown): UpstreamError {
    const { service } = this.options;

    // 401/403 aqui significa que a NOSSA credencial está errada — não é culpa de quem chamou o BFF.
    if (status === 401 || status === 403) {
      return UpstreamError.unavailable(service, 'credencial do BFF recusada', status);
    }
    if (status === 429) {
      return UpstreamError.unavailable(service, 'limite de requisições atingido', status);
    }
    if (status >= 500) {
      return UpstreamError.unavailable(service, `HTTP ${status}`, status);
    }

    const envelope = (typeof payload === 'object' && payload !== null ? payload : {}) as ErrorEnvelope;
    const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'UPSTREAM_REJECTED';
    const message =
      typeof envelope.error?.message === 'string'
        ? envelope.error.message
        : `O serviço ${service} recusou a requisição (HTTP ${status}).`;

    return UpstreamError.rejected(service, status, code, message, envelope.error?.details);
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (text === '') return undefined;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return text;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
