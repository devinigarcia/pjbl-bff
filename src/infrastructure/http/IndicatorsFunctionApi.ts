import type { CallContext } from '../../application/ports/CallContext';
import type { IndicatorsApi } from '../../application/ports/IndicatorsApi';
import type { Indicators, Order, Product } from '../../domain/models';
import type { HttpJsonClient } from './HttpJsonClient';

/**
 * Implementação HTTP da porta IndicatorsApi: chama o HTTP Trigger `calculateIndicators`
 * da Azure Function. A chave (`x-functions-key`) vai nos cabeçalhos padrão do cliente.
 */
export class IndicatorsFunctionApi implements IndicatorsApi {
  constructor(private readonly http: HttpJsonClient) {}

  calculate(input: { products: Product[]; orders: Order[] }, ctx: CallContext): Promise<Indicators> {
    return this.http.request('POST', '/indicators', { ...ctx, body: input });
  }

  async health(ctx: CallContext): Promise<void> {
    await this.http.request('GET', '/health', ctx);
  }
}
