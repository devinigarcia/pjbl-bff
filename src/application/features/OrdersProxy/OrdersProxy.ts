import type { Order, OutboxItem, Page } from '../../../domain/models';
import type { CallContext } from '../../ports/CallContext';
import type { OrdersApi } from '../../ports/OrdersApi';
import { pickQuery } from '../../validation';

const LIST_QUERY = ['status', 'search', 'page', 'pageSize'] as const;
const EVENTS_QUERY = ['limit'] as const;

/**
 * Proxy das operações de pedido que não precisam de orquestração
 * (a criação passa pela feature PlaceOrder, que consulta o catálogo antes).
 */
export class OrdersProxyHandler {
  constructor(private readonly deps: { orders: OrdersApi }) {}

  list(query: unknown, ctx: CallContext): Promise<Page<Order>> {
    return this.deps.orders.list(pickQuery(query, LIST_QUERY), ctx);
  }

  get(id: string, ctx: CallContext): Promise<Order> {
    return this.deps.orders.getById(id, ctx);
  }

  update(id: string, body: unknown, ctx: CallContext): Promise<Order> {
    return this.deps.orders.update(id, body, ctx);
  }

  changeStatus(id: string, body: unknown, ctx: CallContext): Promise<Order> {
    return this.deps.orders.changeStatus(id, body, ctx);
  }

  remove(id: string, ctx: CallContext): Promise<void> {
    return this.deps.orders.remove(id, ctx);
  }

  listEvents(query: unknown, ctx: CallContext): Promise<{ items: OutboxItem[]; total: number }> {
    return this.deps.orders.listEvents(pickQuery(query, EVENTS_QUERY), ctx);
  }
}
