import type { Indicators, Order, OutboxItem, Product } from '../../../domain/models';
import type { CallContext } from '../../ports/CallContext';
import type { IndicatorsApi } from '../../ports/IndicatorsApi';
import type { OrdersApi } from '../../ports/OrdersApi';
import type { ProductsApi } from '../../ports/ProductsApi';

export type SourceStatus = 'ok' | 'error' | 'skipped';

export interface SourceReport {
  status: SourceStatus;
  durationMs: number;
  error?: string;
}

export interface AggregatedData {
  generatedAt: string;
  correlationId: string;
  /** true quando alguma fonte falhou ou foi pulada — a resposta vem com o que deu para buscar. */
  partial: boolean;
  totalDurationMs: number;
  products: { items: Product[]; total: number } | null;
  orders: { items: Order[]; total: number } | null;
  recentEvents: OutboxItem[];
  indicators: Indicators | null;
  sources: {
    msProdutos: SourceReport;
    msPedidos: SourceReport;
    azureFunction: SourceReport;
  };
}

type Measured<T> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; error: string; durationMs: number };

interface Deps {
  products: ProductsApi;
  orders: OrdersApi;
  /** null quando a Function não está configurada (FUNCTION_URL vazia). */
  indicators: IndicatorsApi | null;
  now?: () => number;
}

/**
 * Feature principal do BFF: GET /aggregated-data.
 *
 * Busca produtos e pedidos em paralelo, manda o resultado para a Azure Function
 * calcular os indicadores e devolve tudo num JSON só. Se uma fonte cair, as outras
 * continuam valendo: a resposta sai marcada como `partial` em vez de dar erro.
 */
export class GetAggregatedDataHandler {
  private readonly now: () => number;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  async handle(ctx: CallContext): Promise<AggregatedData> {
    const startedAt = this.now();

    const [productsResult, ordersResult] = await Promise.all([
      this.measure(() => this.deps.products.list({ pageSize: '100' }, ctx)),
      this.measure(async () => {
        const [page, events] = await Promise.all([
          this.deps.orders.list({ pageSize: '100' }, ctx),
          this.deps.orders.listEvents({ limit: '10' }, ctx),
        ]);
        return { page, events };
      }),
    ]);

    const products = productsResult.ok
      ? { items: productsResult.value.items, total: productsResult.value.total }
      : null;
    const orders = ordersResult.ok
      ? { items: ordersResult.value.page.items, total: ordersResult.value.page.total }
      : null;
    const recentEvents = ordersResult.ok ? ordersResult.value.events.items : [];

    const { indicators, report: functionReport } = await this.calculateIndicators(products, orders, ctx);

    const sources = {
      msProdutos: toReport(productsResult),
      msPedidos: toReport(ordersResult),
      azureFunction: functionReport,
    };

    return {
      generatedAt: new Date(this.now()).toISOString(),
      correlationId: ctx.correlationId,
      partial: Object.values(sources).some((source) => source.status !== 'ok'),
      totalDurationMs: this.now() - startedAt,
      products,
      orders,
      recentEvents,
      indicators,
      sources,
    };
  }

  private async calculateIndicators(
    products: AggregatedData['products'],
    orders: AggregatedData['orders'],
    ctx: CallContext,
  ): Promise<{ indicators: Indicators | null; report: SourceReport }> {
    const { indicators: api } = this.deps;

    if (!api) {
      return {
        indicators: null,
        report: { status: 'skipped', durationMs: 0, error: 'Azure Function não configurada (FUNCTION_URL).' },
      };
    }
    if (!products && !orders) {
      // Sem nenhum dado não faz sentido gastar uma execução da Function.
      return {
        indicators: null,
        report: { status: 'skipped', durationMs: 0, error: 'Sem dados de produtos e pedidos para calcular.' },
      };
    }

    const result = await this.measure(() =>
      api.calculate({ products: products?.items ?? [], orders: orders?.items ?? [] }, ctx),
    );
    return { indicators: result.ok ? result.value : null, report: toReport(result) };
  }

  private async measure<T>(task: () => Promise<T>): Promise<Measured<T>> {
    const startedAt = this.now();
    try {
      const value = await task();
      return { ok: true, value, durationMs: this.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha inesperada.';
      return { ok: false, error: message, durationMs: this.now() - startedAt };
    }
  }
}

function toReport(result: Measured<unknown>): SourceReport {
  return result.ok
    ? { status: 'ok', durationMs: result.durationMs }
    : { status: 'error', durationMs: result.durationMs, error: result.error };
}
