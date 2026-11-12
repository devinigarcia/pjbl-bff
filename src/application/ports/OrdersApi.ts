import type { NewOrderPayload, Order, OutboxItem, Page } from '../../domain/models';
import type { QueryParams } from '../validation';
import type { CallContext } from './CallContext';

/** Porta de saída para o ms-pedidos. */
export interface OrdersApi {
  list(query: QueryParams, ctx: CallContext): Promise<Page<Order>>;
  getById(id: string, ctx: CallContext): Promise<Order>;
  create(payload: NewOrderPayload, ctx: CallContext): Promise<Order>;
  update(id: string, body: unknown, ctx: CallContext): Promise<Order>;
  changeStatus(id: string, body: unknown, ctx: CallContext): Promise<Order>;
  remove(id: string, ctx: CallContext): Promise<void>;
  listEvents(query: QueryParams, ctx: CallContext): Promise<{ items: OutboxItem[]; total: number }>;
  health(ctx: CallContext): Promise<void>;
}
