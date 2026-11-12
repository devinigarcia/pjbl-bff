import type { CallContext } from '../../application/ports/CallContext';
import type { ProductsApi } from '../../application/ports/ProductsApi';
import type { QueryParams } from '../../application/validation';
import type { Page, Product, StockMovement, StockMovementResult } from '../../domain/models';
import type { HttpJsonClient } from './HttpJsonClient';

const productPath = (id: string) => `/products/${encodeURIComponent(id)}`;

/** Implementação HTTP da porta ProductsApi (fala com o ms-produtos). */
export class ProdutosHttpApi implements ProductsApi {
  constructor(private readonly http: HttpJsonClient) {}

  list(query: QueryParams, ctx: CallContext): Promise<Page<Product>> {
    return this.http.request('GET', '/products', { ...ctx, query });
  }

  getById(id: string, ctx: CallContext): Promise<Product> {
    return this.http.request('GET', productPath(id), ctx);
  }

  create(body: unknown, ctx: CallContext): Promise<Product> {
    return this.http.request('POST', '/products', { ...ctx, body: body ?? {} });
  }

  update(id: string, body: unknown, ctx: CallContext): Promise<Product> {
    return this.http.request('PUT', productPath(id), { ...ctx, body: body ?? {} });
  }

  async remove(id: string, ctx: CallContext): Promise<void> {
    await this.http.request('DELETE', productPath(id), ctx);
  }

  listStockMovements(id: string, query: QueryParams, ctx: CallContext): Promise<{ items: StockMovement[]; total: number }> {
    return this.http.request('GET', `${productPath(id)}/stock-movements`, { ...ctx, query });
  }

  registerStockMovement(id: string, body: unknown, ctx: CallContext): Promise<StockMovementResult> {
    return this.http.request('POST', `${productPath(id)}/stock-movements`, { ...ctx, body: body ?? {} });
  }

  async health(ctx: CallContext): Promise<void> {
    await this.http.request('GET', '/health', ctx);
  }
}
