import { describe, expect, it } from 'vitest';
import { GetAggregatedDataHandler } from '../../src/application/features/GetAggregatedData/GetAggregatedData';
import { UpstreamError } from '../../src/domain/errors';
import {
  ctx,
  FakeIndicatorsApi,
  FakeOrdersApi,
  FakeProductsApi,
  makeOrder,
  makeOutboxItem,
  makeProduct,
} from '../support/fakes';

function setup() {
  const products = new FakeProductsApi([makeProduct(), makeProduct()]);
  const orders = new FakeOrdersApi([makeOrder()], [makeOutboxItem()]);
  const indicators = new FakeIndicatorsApi();
  const handler = new GetAggregatedDataHandler({ products, orders, indicators });
  return { products, orders, indicators, handler };
}

describe('GetAggregatedData', () => {
  it('junta produtos, pedidos, eventos e indicadores em uma resposta só', async () => {
    const { handler, indicators } = setup();
    indicators.result = { computedBy: 'azure-function', alerts: ['tudo certo'] };

    const data = await handler.handle(ctx);

    expect(data.partial).toBe(false);
    expect(data.correlationId).toBe(ctx.correlationId);
    expect(data.products).toMatchObject({ total: 2 });
    expect(data.products?.items).toHaveLength(2);
    expect(data.orders).toMatchObject({ total: 1 });
    expect(data.recentEvents).toHaveLength(1);
    expect(data.indicators).toEqual({ computedBy: 'azure-function', alerts: ['tudo certo'] });
    expect(data.sources.msProdutos.status).toBe('ok');
    expect(data.sources.msPedidos.status).toBe('ok');
    expect(data.sources.azureFunction.status).toBe('ok');
    expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false);
  });

  it('manda para a Function exatamente os produtos e pedidos que buscou', async () => {
    const { handler, indicators, products, orders } = setup();

    await handler.handle(ctx);

    expect(indicators.calls).toHaveLength(1);
    expect(indicators.calls[0]?.products).toEqual(products.products);
    expect(indicators.calls[0]?.orders).toEqual(orders.orders);
  });

  it('consulta os dois microserviços em paralelo, não um depois do outro', async () => {
    const { handler, products, orders } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    products.gate = gate;
    orders.gate = gate;

    const pending = handler.handle(ctx);
    await new Promise((resolve) => setImmediate(resolve));

    // as duas chamadas já saíram antes de qualquer uma responder
    expect(products.calls.map((call) => call.method)).toEqual(['list']);
    expect(orders.calls.map((call) => call.method).sort()).toEqual(['list', 'listEvents']);

    release();
    const data = await pending;
    expect(data.partial).toBe(false);
  });

  it('pede no máximo 100 itens de cada serviço e os 10 últimos eventos', async () => {
    const { handler, products, orders } = setup();

    await handler.handle(ctx);

    expect(products.calls[0]?.args[0]).toEqual({ pageSize: '100' });
    expect(orders.calls.find((call) => call.method === 'list')?.args[0]).toEqual({ pageSize: '100' });
    expect(orders.calls.find((call) => call.method === 'listEvents')?.args[0]).toEqual({ limit: '10' });
  });

  it('devolve resposta parcial quando o ms-produtos cai, sem lançar erro', async () => {
    const { handler, products, indicators } = setup();
    products.failWith = UpstreamError.unavailable('ms-produtos', 'falha de conexão');

    const data = await handler.handle(ctx);

    expect(data.partial).toBe(true);
    expect(data.products).toBeNull();
    expect(data.orders).not.toBeNull();
    expect(data.sources.msProdutos.status).toBe('error');
    expect(data.sources.msProdutos.error).toContain('ms-produtos');
    // a Function ainda é chamada com o que sobrou (pedidos)
    expect(indicators.calls[0]?.products).toEqual([]);
    expect(data.sources.azureFunction.status).toBe('ok');
  });

  it('devolve resposta parcial quando o ms-pedidos cai', async () => {
    const { handler, orders } = setup();
    orders.failWith = UpstreamError.timeout('ms-pedidos', 8000);

    const data = await handler.handle(ctx);

    expect(data.partial).toBe(true);
    expect(data.orders).toBeNull();
    expect(data.recentEvents).toEqual([]);
    expect(data.products).not.toBeNull();
    expect(data.sources.msPedidos).toMatchObject({ status: 'error' });
  });

  it('pula a Function quando os dois microserviços falharam', async () => {
    const { handler, products, orders, indicators } = setup();
    products.failWith = new Error('fora do ar');
    orders.failWith = new Error('fora do ar');

    const data = await handler.handle(ctx);

    expect(indicators.calls).toHaveLength(0);
    expect(data.sources.azureFunction.status).toBe('skipped');
    expect(data.indicators).toBeNull();
    expect(data.partial).toBe(true);
  });

  it('marca a Function como erro (e indicators null) quando ela falha', async () => {
    const { handler, indicators } = setup();
    indicators.failWith = UpstreamError.unavailable('azure-function', 'HTTP 500', 500);

    const data = await handler.handle(ctx);

    expect(data.indicators).toBeNull();
    expect(data.sources.azureFunction.status).toBe('error');
    expect(data.partial).toBe(true);
    // os dados dos microserviços continuam vindo
    expect(data.products?.total).toBe(2);
    expect(data.orders?.total).toBe(1);
  });

  it('marca a Function como skipped quando ela não está configurada', async () => {
    const { products, orders } = setup();
    const handler = new GetAggregatedDataHandler({ products, orders, indicators: null });

    const data = await handler.handle(ctx);

    expect(data.sources.azureFunction).toMatchObject({ status: 'skipped', durationMs: 0 });
    expect(data.indicators).toBeNull();
    expect(data.partial).toBe(true);
  });

  it('mede a duração de cada fonte e a duração total', async () => {
    const { products, orders, indicators } = setup();
    // relógio falso: cada leitura anda 5 ms
    let clock = 1_000;
    const now = () => (clock += 5);
    const handler = new GetAggregatedDataHandler({ products, orders, indicators, now });

    const data = await handler.handle(ctx);

    expect(data.sources.msProdutos.durationMs).toBeGreaterThan(0);
    expect(data.sources.msPedidos.durationMs).toBeGreaterThan(0);
    expect(data.sources.azureFunction.durationMs).toBeGreaterThan(0);
    expect(data.totalDurationMs).toBeGreaterThanOrEqual(data.sources.azureFunction.durationMs);
  });
});
