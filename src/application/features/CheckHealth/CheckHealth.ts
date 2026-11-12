import type { CallContext } from '../../ports/CallContext';
import type { IndicatorsApi } from '../../ports/IndicatorsApi';
import type { OrdersApi } from '../../ports/OrdersApi';
import type { ProductsApi } from '../../ports/ProductsApi';

export interface DependencyHealth {
  status: 'ok' | 'error' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: 'pjbl-bff';
  dependencies: {
    msProdutos: DependencyHealth;
    msPedidos: DependencyHealth;
    azureFunction: DependencyHealth;
  };
  timestamp: string;
}

interface Deps {
  products: ProductsApi;
  orders: OrdersApi;
  indicators: IndicatorsApi | null;
  now?: () => number;
}

/**
 * GET /health — além de dizer que o BFF está de pé, pergunta para cada serviço de trás
 * se ele está bem. Ajuda bastante a descobrir qual peça caiu durante a demonstração.
 */
export class CheckHealthHandler {
  private readonly now: () => number;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  async handle(ctx: CallContext): Promise<HealthReport> {
    const { products, orders, indicators } = this.deps;

    const [msProdutos, msPedidos, azureFunction] = await Promise.all([
      this.probe(() => products.health(ctx)),
      this.probe(() => orders.health(ctx)),
      indicators
        ? this.probe(() => indicators.health(ctx))
        : Promise.resolve<DependencyHealth>({ status: 'skipped', durationMs: 0 }),
    ]);

    const dependencies = { msProdutos, msPedidos, azureFunction };
    const degraded = Object.values(dependencies).some((dependency) => dependency.status === 'error');

    return {
      status: degraded ? 'degraded' : 'ok',
      service: 'pjbl-bff',
      dependencies,
      timestamp: new Date(this.now()).toISOString(),
    };
  }

  private async probe(check: () => Promise<void>): Promise<DependencyHealth> {
    const startedAt = this.now();
    try {
      await check();
      return { status: 'ok', durationMs: this.now() - startedAt };
    } catch (error) {
      return {
        status: 'error',
        durationMs: this.now() - startedAt,
        error: error instanceof Error ? error.message : 'Falha inesperada.',
      };
    }
  }
}
