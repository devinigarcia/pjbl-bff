import type { Page, Product, StockMovement, StockMovementResult } from '../../../domain/models';
import type { CallContext } from '../../ports/CallContext';
import type { ProductsApi } from '../../ports/ProductsApi';
import { pickQuery } from '../../validation';

const LIST_QUERY = ['search', 'category', 'ids', 'page', 'pageSize'] as const;
const MOVEMENTS_QUERY = ['limit'] as const;

/**
 * Proxy do CRUD de produtos. O front nunca fala com o ms-produtos direto.
 * A validação de verdade fica no microserviço (ele é o dono da regra);
 * aqui a gente só filtra os parâmetros de consulta e repassa.
 */
export class ProductsProxyHandler {
  constructor(private readonly deps: { products: ProductsApi }) {}

  list(query: unknown, ctx: CallContext): Promise<Page<Product>> {
    return this.deps.products.list(pickQuery(query, LIST_QUERY), ctx);
  }

  get(id: string, ctx: CallContext): Promise<Product> {
    return this.deps.products.getById(id, ctx);
  }

  create(body: unknown, ctx: CallContext): Promise<Product> {
    return this.deps.products.create(body, ctx);
  }

  update(id: string, body: unknown, ctx: CallContext): Promise<Product> {
    return this.deps.products.update(id, body, ctx);
  }

  remove(id: string, ctx: CallContext): Promise<void> {
    return this.deps.products.remove(id, ctx);
  }

  listStockMovements(id: string, query: unknown, ctx: CallContext): Promise<{ items: StockMovement[]; total: number }> {
    return this.deps.products.listStockMovements(id, pickQuery(query, MOVEMENTS_QUERY), ctx);
  }

  registerStockMovement(id: string, body: unknown, ctx: CallContext): Promise<StockMovementResult> {
    return this.deps.products.registerStockMovement(id, body, ctx);
  }
}
