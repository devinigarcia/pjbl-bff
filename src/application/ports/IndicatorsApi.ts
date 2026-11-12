import type { Indicators, Order, Product } from '../../domain/models';
import type { CallContext } from './CallContext';

/** Porta de saída para a Azure Function que calcula os indicadores (HTTP Trigger). */
export interface IndicatorsApi {
  calculate(input: { products: Product[]; orders: Order[] }, ctx: CallContext): Promise<Indicators>;
  health(ctx: CallContext): Promise<void>;
}
