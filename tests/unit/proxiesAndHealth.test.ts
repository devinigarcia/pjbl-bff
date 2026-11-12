import { describe, expect, it } from 'vitest';
import { buildServerTiming } from '../../src/api/features/GetAggregatedData/GetAggregatedDataEndpoint';
import { CheckHealthHandler } from '../../src/application/features/CheckHealth/CheckHealth';
import { OrdersProxyHandler } from '../../src/application/features/OrdersProxy/OrdersProxy';
import { ProductsProxyHandler } from '../../src/application/features/ProductsProxy/ProductsProxy';
import { pickQuery } from '../../src/application/validation';
import { loadConfig } from '../../src/infrastructure/config';
import { ctx, FakeIndicatorsApi, FakeOrdersApi, FakeProductsApi } from '../support/fakes';

describe('pickQuery', () => {
  it('deixa passar só os parâmetros conhecidos e descarta vazios', () => {
    const picked = pickQuery(
      { search: ' café ', page: '2', hack: 'x', category: '', ids: ['a,b', 'c'], pageSize: 10 },
      ['search', 'category', 'ids', 'page', 'pageSize'],
    );

    expect(picked).toEqual({ search: 'café', page: '2', ids: 'a,b' });
  });

  it('aguenta entrada que não é objeto', () => {
    expect(pickQuery(undefined, ['a'])).toEqual({});
    expect(pickQuery('texto', ['a'])).toEqual({});
  });
});

describe('ProductsProxy e OrdersProxy', () => {
  it('filtra os parâmetros de consulta antes de repassar ao ms-produtos', async () => {
    const products = new FakeProductsApi();
    const handler = new ProductsProxyHandler({ products });

    await handler.list({ search: 'cafe', drop: 'table', pageSize: '5' }, ctx);
    await handler.listStockMovements('p1', { limit: '3', outro: '1' }, ctx);

    expect(products.calls[0]?.args[0]).toEqual({ search: 'cafe', pageSize: '5' });
    expect(products.calls[1]?.args.slice(0, 2)).toEqual(['p1', { limit: '3' }]);
  });

  it('repassa corpo e id do jeito que chegaram', async () => {
    const products = new FakeProductsApi();
    const handler = new ProductsProxyHandler({ products });
    const body = { name: 'Novo nome', price: 9.9 };

    await handler.update('p1', body, ctx);
    await handler.remove('p1', ctx);
    await handler.registerStockMovement('p1', { type: 'ENTRADA', quantity: 2 }, ctx);

    expect(products.calls.map((call) => call.method)).toEqual(['update', 'remove', 'registerStockMovement']);
    expect(products.calls[0]?.args.slice(0, 2)).toEqual(['p1', body]);
  });

  it('filtra os parâmetros de consulta dos pedidos e dos eventos', async () => {
    const orders = new FakeOrdersApi();
    const handler = new OrdersProxyHandler({ orders });

    await handler.list({ status: 'PAGO', search: 'ana', x: '1' }, ctx);
    await handler.listEvents({ limit: '5', y: '2' }, ctx);
    await handler.changeStatus('o1', { status: 'CANCELADO' }, ctx);

    expect(orders.calls[0]?.args[0]).toEqual({ status: 'PAGO', search: 'ana' });
    expect(orders.calls[1]?.args[0]).toEqual({ limit: '5' });
    expect(orders.calls[2]?.args.slice(0, 2)).toEqual(['o1', { status: 'CANCELADO' }]);
  });
});

describe('CheckHealth', () => {
  it('responde ok quando todas as dependências respondem', async () => {
    const handler = new CheckHealthHandler({
      products: new FakeProductsApi(),
      orders: new FakeOrdersApi(),
      indicators: new FakeIndicatorsApi(),
    });

    const report = await handler.handle(ctx);

    expect(report.status).toBe('ok');
    expect(report.service).toBe('pjbl-bff');
    expect(Object.values(report.dependencies).every((dependency) => dependency.status === 'ok')).toBe(true);
  });

  it('responde degraded e aponta qual dependência caiu', async () => {
    const orders = new FakeOrdersApi();
    orders.failWith = new Error('ms-pedidos fora do ar');
    const handler = new CheckHealthHandler({
      products: new FakeProductsApi(),
      orders,
      indicators: new FakeIndicatorsApi(),
    });

    const report = await handler.handle(ctx);

    expect(report.status).toBe('degraded');
    expect(report.dependencies.msPedidos).toMatchObject({ status: 'error', error: 'ms-pedidos fora do ar' });
    expect(report.dependencies.msProdutos.status).toBe('ok');
  });

  it('não considera degradado quando a Function simplesmente não está configurada', async () => {
    const handler = new CheckHealthHandler({
      products: new FakeProductsApi(),
      orders: new FakeOrdersApi(),
      indicators: null,
    });

    const report = await handler.handle(ctx);

    expect(report.status).toBe('ok');
    expect(report.dependencies.azureFunction.status).toBe('skipped');
  });
});

describe('Server-Timing', () => {
  it('lista o tempo de cada fonte e o total', () => {
    const header = buildServerTiming({
      totalDurationMs: 180,
      sources: {
        msProdutos: { status: 'ok', durationMs: 40 },
        msPedidos: { status: 'ok', durationMs: 55 },
        azureFunction: { status: 'error', durationMs: 90, error: 'x' },
      },
    });

    expect(header).toBe('ms-produtos;dur=40, ms-pedidos;dur=55, azure-function;dur=90, total;dur=180');
  });
});

describe('config', () => {
  it('usa valores padrão para rodar local sem .env', () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      port: 3000,
      produtosApiUrl: 'http://localhost:3001',
      pedidosApiUrl: 'http://localhost:3002',
      corsOrigins: '*',
      rateLimitPerMinute: 300,
    });
    expect(config.functionUrl).toBeUndefined();
    expect(config.gatewaySecret).toBeUndefined();
  });

  it('trata variável vazia como não definida e tira a barra do final das URLs', () => {
    const config = loadConfig({
      FUNCTION_URL: '',
      GATEWAY_SECRET: '  ',
      PRODUTOS_API_URL: 'https://produtos.exemplo.com/',
      CORS_ORIGIN: 'https://a.com, https://b.com',
      PORT: '8080',
    });

    expect(config.functionUrl).toBeUndefined();
    expect(config.gatewaySecret).toBeUndefined();
    expect(config.produtosApiUrl).toBe('https://produtos.exemplo.com');
    expect(config.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
    expect(config.port).toBe(8080);
  });

  it('não deixa o serviço subir com configuração inválida', () => {
    expect(() => loadConfig({ PEDIDOS_API_URL: 'isso-nao-e-url' })).toThrow(/Configuração inválida/);
    expect(() => loadConfig({ PORT: '99999' })).toThrow(/PORT/);
  });
});
