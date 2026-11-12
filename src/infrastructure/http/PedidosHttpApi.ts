import type { CallContext } from '../../application/ports/CallContext';
import type { OrdersApi } from '../../application/ports/OrdersApi';
import type { QueryParams } from '../../application/validation';
import type { NewOrderPayload, Order, OutboxItem, Page } from '../../domain/models';
import type { HttpJsonClient } from './HttpJsonClient';

const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

/** Implementação HTTP da porta OrdersApi (fala com o ms-pedidos). */
export class PedidosHttpApi implements OrdersApi {
  constructor(private readonly http: HttpJsonClient) {}

  list(query: QueryParams, ctx: CallContext): Promise<Page<Order>> {
    return this.http.request('GET', '/orders', { ...ctx, query });
  }

  getById(id: string, ctx: CallContext): Promise<Order> {
    return this.http.request('GET', orderPath(id), ctx);
  }

  create(payload: NewOrderPayload, ctx: CallContext): Promise<Order> {
    return this.http.request('POST', '/orders', { ...ctx, body: payload });
  }

  update(id: string, body: unknown, ctx: CallContext): Promise<Order> {
    return this.http.request('PUT', orderPath(id), { ...ctx, body: body ?? {} });
  }

  changeStatus(id: string, body: unknown, ctx: CallContext): Promise<Order> {
    return this.http.request('PATCH', `${orderPath(id)}/status`, { ...ctx, body: body ?? {} });
  }

  async remove(id: string, ctx: CallContext): Promise<void> {
    await this.http.request('DELETE', orderPath(id), ctx);
  }

  listEvents(query: QueryParams, ctx: CallContext): Promise<{ items: OutboxItem[]; total: number }> {
    return this.http.request('GET', '/events', { ...ctx, query });
  }

  async health(ctx: CallContext): Promise<void> {
    await this.http.request('GET', '/health', ctx);
  }
}
