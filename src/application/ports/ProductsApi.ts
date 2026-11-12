import type { Page, Product, StockMovement, StockMovementResult } from '../../domain/models';
import type { QueryParams } from '../validation';
import type { CallContext } from './CallContext';

/** Porta de saída para o ms-produtos. A implementação HTTP fica na infrastructure. */
export interface ProductsApi {
  list(query: QueryParams, ctx: CallContext): Promise<Page<Product>>;
  getById(id: string, ctx: CallContext): Promise<Product>;
  create(body: unknown, ctx: CallContext): Promise<Product>;
  update(id: string, body: unknown, ctx: CallContext): Promise<Product>;
  remove(id: string, ctx: CallContext): Promise<void>;
  listStockMovements(id: string, query: QueryParams, ctx: CallContext): Promise<{ items: StockMovement[]; total: number }>;
  registerStockMovement(id: string, body: unknown, ctx: CallContext): Promise<StockMovementResult>;
  health(ctx: CallContext): Promise<void>;
}
