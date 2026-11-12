import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  /** segura a resposta por alguns ms (para testar timeout) */
  delayMs?: number;
}

export type FakeHandler = (request: RecordedRequest) => FakeReply | undefined;

export interface FakeUpstream {
  url: string;
  requests: RecordedRequest[];
  /** troca o comportamento no meio do teste */
  setHandler(handler: FakeHandler): void;
  close(): Promise<void>;
}

/**
 * Sobe um servidor HTTP de verdade numa porta livre, fazendo o papel de um microserviço.
 * Assim o teste de integração exercita o cliente HTTP real do BFF (fetch, timeout, cabeçalhos).
 */
export async function startFakeUpstream(initial: FakeHandler): Promise<FakeUpstream> {
  let handler = initial;
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }

      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body,
      };
      requests.push(recorded);

      const reply = handler(recorded) ?? { status: 404, body: { error: { code: 'NOT_MAPPED_IN_FAKE', message: 'rota não mapeada no fake' } } };
      const send = () => {
        const status = reply.status ?? 200;
        if (reply.body === undefined) {
          res.writeHead(status).end();
          return;
        }
        const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        res.writeHead(status, {
          'content-type': typeof reply.body === 'string' ? 'text/plain' : 'application/json',
        });
        res.end(payload);
      };

      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    setHandler(next) {
      handler = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Devolve uma URL em que não tem ninguém escutando (simula serviço fora do ar). */
export async function unusedUrl(): Promise<string> {
  const probe = await startFakeUpstream(() => ({ status: 200 }));
  await probe.close();
  return probe.url;
}
