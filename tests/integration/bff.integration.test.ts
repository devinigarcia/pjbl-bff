import type { Express } from 'express';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app';
import { CheckHealthHandler } from '../../src/application/features/CheckHealth/CheckHealth';
import { GetAggregatedDataHandler } from '../../src/application/features/GetAggregatedData/GetAggregatedData';
import { OrdersProxyHandler } from '../../src/application/features/OrdersProxy/OrdersProxy';
import { PlaceOrderHandler } from '../../src/application/features/PlaceOrder/PlaceOrder';
import { ProductsProxyHandler } from '../../src/application/features/ProductsProxy/ProductsProxy';
import { HttpJsonClient } from '../../src/infrastructure/http/HttpJsonClient';
import { IndicatorsFunctionApi } from '../../src/infrastructure/http/IndicatorsFunctionApi';
import { PedidosHttpApi } from '../../src/infrastructure/http/PedidosHttpApi';
import { ProdutosHttpApi } from '../../src/infrastructure/http/ProdutosHttpApi';
import { makeOrder, makeOutboxItem, makeProduct } from '../support/fakes';
import { startFakeUpstream, unusedUrl, type FakeHandler, type FakeUpstream } from '../support/fakeUpstream';

// Teste de integração: BFF de verdade (Express + cliente HTTP real) falando com
// três servidores HTTP falsos que fazem o papel do ms-produtos, ms-pedidos e da Function.

const logger = pino({ level: 'silent' });

const cafe = makeProduct({ id: 'cafe', name: 'Café 500g', price: 24.9, stock: 10 });
const acucar = makeProduct({ id: 'acucar', name: 'Açúcar 1kg', price: 5.5, stock: 3 });
const pedido = makeOrder({ id: 'pedido-1' });
const evento = makeOutboxItem({ aggregateId: 'pedido-1' });
const indicadores = { computedBy: 'azure-function', alerts: ['1 produto está com estoque baixo.'] };

const produtosHandler: FakeHandler = (req) => {
  if (req.path === '/health') return { body: { status: 'ok' } };
  if (req.method === 'GET' && req.path === '/products') {
    const ids = req.query.ids?.split(',');
    const items = [cafe, acucar].filter((product) => !ids || ids.includes(product.id));
    return { body: { items, total: items.length, page: 1, pageSize: 100 } };
  }
  if (req.method === 'POST' && req.path === '/products') {
    const body = req.body as { sku?: string };
    if (body.sku === 'CAFE-500G') {
      return { status: 409, body: { error: { code: 'SKU_ALREADY_EXISTS', message: 'Já existe um produto com o SKU CAFE-500G.' } } };
    }
    if (!body.sku) {
      return {
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: [{ field: 'sku', message: 'Informe o SKU.' }] } },
      };
    }
    return { status: 201, body: makeProduct({ id: 'novo', sku: body.sku }) };
  }
  if (req.method === 'GET' && req.path === '/products/cafe') return { body: cafe };
  if (req.method === 'GET' && req.path === '/products/nao-existe') {
    return { status: 404, body: { error: { code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado.' } } };
  }
  if (req.method === 'DELETE' && req.path === '/products/cafe') return { status: 204 };
  if (req.method === 'POST' && req.path === '/products/cafe/stock-movements') {
    const body = req.body as { eventId?: string };
    const result = { movement: { id: 'm1' }, product: cafe, duplicate: body.eventId === 'repetido' };
    return { status: result.duplicate ? 200 : 201, body: result };
  }
  return undefined;
};

const pedidosHandler: FakeHandler = (req) => {
  if (req.path === '/health') return { body: { status: 'ok' } };
  if (req.method === 'GET' && req.path === '/orders') return { body: { items: [pedido], total: 1, page: 1, pageSize: 100 } };
  if (req.method === 'GET' && req.path === '/events') return { body: { items: [evento], total: 1 } };
  if (req.method === 'POST' && req.path === '/orders') {
    const body = req.body as { customerName: string; customerEmail: string; items: never[] };
    return { status: 201, body: makeOrder({ id: 'pedido-novo', ...body }) };
  }
  if (req.method === 'PATCH' && req.path === '/orders/pedido-1/status') {
    return {
      status: 409,
      body: { error: { code: 'INVALID_STATUS_TRANSITION', message: 'Não é possível mudar de PENDENTE para ENTREGUE.' } },
    };
  }
  if (req.method === 'DELETE' && req.path === '/orders/pedido-1') {
    return { status: 409, body: { error: { code: 'ORDER_NOT_DELETABLE', message: 'Só é possível excluir pedidos cancelados.' } } };
  }
  return undefined;
};

const functionHandler: FakeHandler = (req) => {
  if (req.path === '/api/health') return { body: { status: 'ok' } };
  if (req.method === 'POST' && req.path === '/api/indicators') return { body: indicadores };
  return undefined;
};

interface Urls {
  produtos: string;
  pedidos: string;
  func: string | null;
}

function buildApp(urls: Urls, overrides: { gatewaySecret?: string; rateLimitPerMinute?: number; timeoutMs?: number } = {}): Express {
  const client = (service: string, baseUrl: string, headers: Record<string, string>) =>
    new HttpJsonClient({ service, baseUrl, timeoutMs: overrides.timeoutMs ?? 2000, defaultHeaders: headers, logger });

  const products = new ProdutosHttpApi(client('ms-produtos', urls.produtos, { 'x-api-key': 'chave-produtos' }));
  const orders = new PedidosHttpApi(client('ms-pedidos', urls.pedidos, { 'x-api-key': 'chave-pedidos' }));
  const indicators = urls.func
    ? new IndicatorsFunctionApi(client('azure-function', `${urls.func}/api`, { 'x-functions-key': 'chave-function' }))
    : null;

  return createApp({
    handlers: {
      getAggregatedData: new GetAggregatedDataHandler({ products, orders, indicators }),
      placeOrder: new PlaceOrderHandler({ products, orders }),
      productsProxy: new ProductsProxyHandler({ products }),
      ordersProxy: new OrdersProxyHandler({ orders }),
      checkHealth: new CheckHealthHandler({ products, orders, indicators }),
    },
    settings: {
      gatewaySecret: overrides.gatewaySecret,
      corsOrigins: '*',
      rateLimitPerMinute: overrides.rateLimitPerMinute ?? 1000,
    },
    logger,
  });
}

describe('BFF — integração HTTP', () => {
  let produtos: FakeUpstream;
  let pedidos: FakeUpstream;
  let func: FakeUpstream;
  let urls: Urls;
  let app: Express;

  beforeAll(async () => {
    [produtos, pedidos, func] = await Promise.all([
      startFakeUpstream(produtosHandler),
      startFakeUpstream(pedidosHandler),
      startFakeUpstream(functionHandler),
    ]);
    urls = { produtos: produtos.url, pedidos: pedidos.url, func: func.url };
    app = buildApp(urls);
  });

  afterAll(async () => {
    await Promise.all([produtos.close(), pedidos.close(), func.close()]);
  });

  beforeEach(() => {
    produtos.setHandler(produtosHandler);
    pedidos.setHandler(pedidosHandler);
    func.setHandler(functionHandler);
    produtos.requests.length = 0;
    pedidos.requests.length = 0;
    func.requests.length = 0;
  });

  describe('GET /aggregated-data', () => {
    it('consome os três serviços e devolve tudo em um único JSON', async () => {
      const response = await request(app).get('/aggregated-data').expect(200);

      expect(response.body.partial).toBe(false);
      expect(response.body.products).toMatchObject({ total: 2 });
      expect(response.body.orders).toMatchObject({ total: 1 });
      expect(response.body.recentEvents).toHaveLength(1);
      expect(response.body.indicators).toEqual(indicadores);
      expect(response.body.sources).toMatchObject({
        msProdutos: { status: 'ok' },
        msPedidos: { status: 'ok' },
        azureFunction: { status: 'ok' },
      });

      // a Function recebeu os dados dos dois microserviços
      const sent = func.requests.find((req) => req.path === '/api/indicators')?.body as { products: unknown[]; orders: unknown[] };
      expect(sent.products).toHaveLength(2);
      expect(sent.orders).toHaveLength(1);
    });

    it('devolve Server-Timing, no-store e x-served-by', async () => {
      const response = await request(app).get('/aggregated-data').expect(200);

      expect(response.headers['server-timing']).toMatch(
        /^ms-produtos;dur=\d+, ms-pedidos;dur=\d+, azure-function;dur=\d+, total;dur=\d+$/,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-served-by']).toBe('pjbl-bff');
    });

    it('propaga o mesmo x-correlation-id para os três serviços e devolve na resposta', async () => {
      const response = await request(app).get('/aggregated-data').set('x-correlation-id', 'demo-video-0001').expect(200);

      expect(response.headers['x-correlation-id']).toBe('demo-video-0001');
      expect(response.body.correlationId).toBe('demo-video-0001');
      for (const upstream of [produtos, pedidos, func]) {
        expect(upstream.requests.length).toBeGreaterThan(0);
        expect(upstream.requests.every((req) => req.headers['x-correlation-id'] === 'demo-video-0001')).toBe(true);
      }
    });

    it('gera um correlation-id quando o cliente não manda (ou manda lixo)', async () => {
      const response = await request(app).get('/aggregated-data').set('x-correlation-id', '<script>').expect(200);

      expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('envia as chaves internas certas para cada serviço', async () => {
      await request(app).get('/aggregated-data').expect(200);

      expect(produtos.requests[0]?.headers['x-api-key']).toBe('chave-produtos');
      expect(pedidos.requests[0]?.headers['x-api-key']).toBe('chave-pedidos');
      expect(func.requests[0]?.headers['x-functions-key']).toBe('chave-function');
    });

    it('responde 200 parcial quando um microserviço devolve 500', async () => {
      produtos.setHandler(() => ({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'quebrou' } } }));

      const response = await request(app).get('/aggregated-data').expect(200);

      expect(response.body.partial).toBe(true);
      expect(response.body.products).toBeNull();
      expect(response.body.orders).not.toBeNull();
      expect(response.body.sources.msProdutos.status).toBe('error');
      expect(response.body.indicators).toEqual(indicadores);
    });

    it('responde 200 parcial quando a Function está fora do ar', async () => {
      const semFunction = buildApp({ ...urls, func: await unusedUrl() });

      const response = await request(semFunction).get('/aggregated-data').expect(200);

      expect(response.body.partial).toBe(true);
      expect(response.body.indicators).toBeNull();
      expect(response.body.sources.azureFunction.status).toBe('error');
      expect(response.body.products.total).toBe(2);
    });

    it('marca a Function como skipped quando FUNCTION_URL não foi configurada', async () => {
      const semFunction = buildApp({ ...urls, func: null });

      const response = await request(semFunction).get('/aggregated-data').expect(200);

      expect(response.body.sources.azureFunction.status).toBe('skipped');
      expect(func.requests).toHaveLength(0);
    });

    it('trata timeout de um serviço como falha daquela fonte', async () => {
      const apressado = buildApp(urls, { timeoutMs: 150 });
      pedidos.setHandler((req) => ({ ...pedidosHandler(req), delayMs: 600 }));

      const response = await request(apressado).get('/aggregated-data').expect(200);

      expect(response.body.sources.msPedidos.status).toBe('error');
      expect(response.body.sources.msPedidos.error).toMatch(/não respondeu/);
      expect(response.body.sources.msProdutos.status).toBe('ok');
    });
  });

  describe('POST /orders (orquestrado)', () => {
    const body = { customerName: 'Ana Souza', customerEmail: 'ana@exemplo.com', items: [{ productId: 'cafe', quantity: 2 }] };

    it('consulta o catálogo, cria o pedido com preço oficial e responde 201', async () => {
      const response = await request(app).post('/orders').send(body).expect(201);

      expect(response.headers.location).toBe('/orders/pedido-novo');
      expect(response.body.stock.mode).toBe('event-driven');
      expect(produtos.requests[0]?.query).toMatchObject({ ids: 'cafe' });
      expect(pedidos.requests[0]?.body).toEqual({
        customerName: 'Ana Souza',
        customerEmail: 'ana@exemplo.com',
        items: [{ productId: 'cafe', productName: 'Café 500g', unitPrice: 24.9, quantity: 2 }],
      });
    });

    it('responde 409 INSUFFICIENT_STOCK com os detalhes e não chama o ms-pedidos', async () => {
      const response = await request(app)
        .post('/orders')
        .send({ ...body, items: [{ productId: 'acucar', quantity: 9 }] })
        .expect(409);

      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(response.body.error.details).toEqual([
        { productId: 'acucar', productName: 'Açúcar 1kg', requested: 9, available: 3 },
      ]);
      expect(pedidos.requests).toHaveLength(0);
    });

    it('responde 422 PRODUCT_NOT_FOUND para produto que não existe', async () => {
      const response = await request(app)
        .post('/orders')
        .send({ ...body, items: [{ productId: 'fantasma', quantity: 1 }] })
        .expect(422);

      expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('responde 400 VALIDATION_ERROR com a lista de campos', async () => {
      const response = await request(app).post('/orders').send({ customerName: '', items: [] }).expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.length).toBeGreaterThanOrEqual(3);
      expect(response.body.error.correlationId).toBe(response.headers['x-correlation-id']);
    });

    it('responde 400 INVALID_JSON para corpo quebrado', async () => {
      const response = await request(app).post('/orders').set('content-type', 'application/json').send('{"customerName":').expect(400);

      expect(response.body.error.code).toBe('INVALID_JSON');
    });
  });

  describe('proxies de CRUD', () => {
    it('lista produtos repassando só os filtros conhecidos', async () => {
      const response = await request(app).get('/products?search=cafe&pageSize=5&malicioso=1').expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(produtos.requests[0]?.query).toEqual({ search: 'cafe', pageSize: '5' });
    });

    it('cria produto e devolve 201 com Location', async () => {
      const response = await request(app).post('/products').send({ sku: 'NOVO-1', name: 'Novo', category: 'X', price: 1 }).expect(201);

      expect(response.headers.location).toBe('/products/novo');
    });

    it('repassa 4xx do microserviço como veio (409 SKU duplicado, 400 validação, 404)', async () => {
      const conflict = await request(app).post('/products').send({ sku: 'CAFE-500G' }).expect(409);
      expect(conflict.body.error).toMatchObject({ code: 'SKU_ALREADY_EXISTS', message: 'Já existe um produto com o SKU CAFE-500G.' });

      const invalid = await request(app).post('/products').send({}).expect(400);
      expect(invalid.body.error.details).toEqual([{ field: 'sku', message: 'Informe o SKU.' }]);

      const missing = await request(app).get('/products/nao-existe').expect(404);
      expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');
      expect(missing.body.error.correlationId).toBe(missing.headers['x-correlation-id']);
    });

    it('exclui produto com 204 sem corpo', async () => {
      const response = await request(app).delete('/products/cafe').expect(204);

      expect(response.text).toBe('');
    });

    it('movimentação de estoque: 201 quando aplica, 200 quando é repetida', async () => {
      await request(app).post('/products/cafe/stock-movements').send({ type: 'ENTRADA', quantity: 5 }).expect(201);

      const repeated = await request(app)
        .post('/products/cafe/stock-movements')
        .send({ type: 'SAIDA', quantity: 5, eventId: 'repetido' })
        .expect(200);
      expect(repeated.body.duplicate).toBe(true);
    });

    it('repassa as regras de negócio do ms-pedidos (transição inválida, excluir não cancelado)', async () => {
      const transition = await request(app).patch('/orders/pedido-1/status').send({ status: 'ENTREGUE' }).expect(409);
      expect(transition.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      const removal = await request(app).delete('/orders/pedido-1').expect(409);
      expect(removal.body.error.code).toBe('ORDER_NOT_DELETABLE');
    });

    it('lista os eventos do outbox', async () => {
      const response = await request(app).get('/events?limit=5').expect(200);

      expect(response.body.items[0].status).toBe('PUBLICADO');
      expect(pedidos.requests[0]?.query).toEqual({ limit: '5' });
    });
  });

  describe('falhas dos serviços de trás', () => {
    it('responde 502 UPSTREAM_UNAVAILABLE quando o microserviço está fora do ar', async () => {
      const semProdutos = buildApp({ ...urls, produtos: await unusedUrl() });

      const response = await request(semProdutos).get('/products').expect(502);

      expect(response.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(response.body.error.details).toEqual({ service: 'ms-produtos' });
    });

    it('responde 502 quando o microserviço devolve 5xx', async () => {
      pedidos.setHandler(() => ({ status: 503, body: 'Service Unavailable' }));

      const response = await request(app).get('/orders').expect(502);

      expect(response.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    });

    it('responde 502 (e não 401) quando o microserviço recusa a chave interna do BFF', async () => {
      produtos.setHandler(() => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'x-api-key inválida' } } }));

      const response = await request(app).get('/products').expect(502);

      expect(response.body.error.message).toMatch(/credencial/);
    });

    it('responde 504 UPSTREAM_TIMEOUT quando o microserviço demora demais', async () => {
      const apressado = buildApp(urls, { timeoutMs: 150 });
      produtos.setHandler((req) => ({ ...produtosHandler(req), delayMs: 600 }));

      const response = await request(apressado).get('/products').expect(504);

      expect(response.body.error.code).toBe('UPSTREAM_TIMEOUT');
    });
  });

  describe('segurança', () => {
    it('com GATEWAY_SECRET ligado, recusa quem não veio pelo gateway', async () => {
      const protegido = buildApp(urls, { gatewaySecret: 'segredo-do-gateway' });

      const semCabecalho = await request(protegido).get('/aggregated-data').expect(401);
      expect(semCabecalho.body.error.code).toBe('UNAUTHORIZED');

      await request(protegido).get('/products').set('x-gateway-secret', 'errado').expect(401);
      expect(produtos.requests).toHaveLength(0);
    });

    it('com GATEWAY_SECRET ligado, aceita quem manda o cabeçalho certo', async () => {
      const protegido = buildApp(urls, { gatewaySecret: 'segredo-do-gateway' });

      await request(protegido).get('/aggregated-data').set('x-gateway-secret', 'segredo-do-gateway').expect(200);
    });

    it('health, Swagger e preflight de CORS continuam abertos mesmo com o segredo ligado', async () => {
      const protegido = buildApp(urls, { gatewaySecret: 'segredo-do-gateway' });

      await request(protegido).get('/health').expect(200);
      await request(protegido).get('/openapi.json').expect(200);
      await request(protegido).get('/docs/').expect(200);
      await request(protegido)
        .options('/orders')
        .set('Origin', 'https://front.exemplo.com')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
    });

    it('expõe os cabeçalhos que o front precisa ler via CORS', async () => {
      const response = await request(app).get('/aggregated-data').set('Origin', 'https://front.exemplo.com').expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-expose-headers']).toMatch(/x-correlation-id/);
      expect(response.headers['access-control-expose-headers']).toMatch(/server-timing/);
    });

    it('não entrega o cabeçalho x-powered-by', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('aplica rate limit e responde 429 no formato padrão', async () => {
      const limitado = buildApp(urls, { rateLimitPerMinute: 2 });

      await request(limitado).get('/products').expect(200);
      await request(limitado).get('/products').expect(200);
      const blocked = await request(limitado).get('/products').expect(429);

      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      // health não entra na conta
      await request(limitado).get('/health').expect(200);
    });
  });

  describe('infra e documentação', () => {
    it('GET /health mostra o estado de cada dependência', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'pjbl-bff',
        dependencies: { msProdutos: { status: 'ok' }, msPedidos: { status: 'ok' }, azureFunction: { status: 'ok' } },
      });
    });

    it('GET /health responde degraded (mas 200) quando uma dependência cai', async () => {
      const semPedidos = buildApp({ ...urls, pedidos: await unusedUrl() });

      const response = await request(semPedidos).get('/health').expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.dependencies.msPedidos.status).toBe('error');
    });

    it('GET / redireciona para o Swagger', async () => {
      const response = await request(app).get('/').expect(302);

      expect(response.headers.location).toBe('/docs');
    });

    it('rota desconhecida responde 404 no formato padrão', async () => {
      const response = await request(app).get('/nao-existe').expect(404);

      expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    });

    it('toda rota registrada no Express está documentada no OpenAPI (e vice-versa)', async () => {
      const { body: spec } = await request(app).get('/openapi.json').expect(200);

      const documented = Object.entries(spec.paths as Record<string, Record<string, unknown>>)
        .flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`))
        .sort();

      const expected = [
        'GET /aggregated-data',
        'GET /health',
        'GET /products',
        'POST /products',
        'GET /products/{id}',
        'PUT /products/{id}',
        'DELETE /products/{id}',
        'GET /products/{id}/stock-movements',
        'POST /products/{id}/stock-movements',
        'GET /orders',
        'POST /orders',
        'GET /orders/{id}',
        'PUT /orders/{id}',
        'DELETE /orders/{id}',
        'PATCH /orders/{id}/status',
        'GET /events',
      ].sort();

      expect(documented).toEqual(expected);

      // e cada uma dessas rotas existe mesmo no app (não cai no 404 de rota)
      for (const entry of expected) {
        const [method, path] = entry.split(' ') as [string, string];
        const url = path.replace('{id}', 'cafe');
        const response = await request(app)[method.toLowerCase() as 'get'](url).send({});
        expect(response.body?.error?.code, entry).not.toBe('ROUTE_NOT_FOUND');
      }
    });

    it('o OpenAPI tem operationId único em todas as operações (o gateway usa isso na importação)', async () => {
      const { body: spec } = await request(app).get('/openapi.json').expect(200);

      const ids = Object.values(spec.paths as Record<string, Record<string, { operationId?: string }>>).flatMap((operations) =>
        Object.values(operations).map((operation) => operation.operationId),
      );

      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
