import type { CallContext } from '../../src/application/ports/CallContext';
import type { IndicatorsApi } from '../../src/application/ports/IndicatorsApi';
import type { OrdersApi } from '../../src/application/ports/OrdersApi';
import type { ProductsApi } from '../../src/application/ports/ProductsApi';
import type { QueryParams } from '../../src/application/validation';
import type {
  Indicators,
  NewOrderPayload,
  Order,
  OutboxItem,
  Page,
  Product,
  StockMovement,
  StockMovementResult,
} from '../../src/domain/models';

export const ctx: CallContext = { correlationId: 'teste-correlation-id' };

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

export function makeProduct(overrides: Partial<Product> = {}): Product {
  const id = overrides.id ?? nextId('prod');
  return {
    id,
    sku: `SKU-${id}`.toUpperCase(),
    name: `Produto ${id}`,
    description: '',
    category: 'Mercearia',
    price: 10,
    stock: 20,
    lowStock: false,
    createdAt: '2026-11-10T12:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z',
    ...overrides,
  };
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: overrides.id ?? nextId('order'),
    customerName: 'Ana Souza',
    customerEmail: 'ana@exemplo.com',
    status: 'PENDENTE',
    items: [{ productId: 'prod-x', productName: 'Produto X', unitPrice: 10, quantity: 2, subtotal: 20 }],
    total: 20,
    itemCount: 2,
    notes: null,
    allowedTransitions: ['PAGO', 'CANCELADO'],
    createdAt: '2026-11-10T12:05:00.000Z',
    updatedAt: '2026-11-10T12:05:00.000Z',
    ...overrides,
  };
}

export function makeOutboxItem(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: nextId('evt'),
    type: 'order.created',
    aggregateId: 'order-1',
    occurredAt: '2026-11-10T12:05:00.000Z',
    processedAt: '2026-11-10T12:05:02.000Z',
    attempts: 1,
    lastError: null,
    status: 'PUBLICADO',
    payload: {},
    ...overrides,
  };
}

interface Call {
  method: string;
  args: unknown[];
}

const page = <T>(items: T[]): Page<T> => ({ items, total: items.length, page: 1, pageSize: 100 });

/** ms-produtos de mentira, em memória. `failWith` simula o serviço fora do ar. */
export class FakeProductsApi implements ProductsApi {
  calls: Call[] = [];
  failWith: Error | null = null;
  /** se definido, toda chamada espera essa promise antes de responder (para testar paralelismo) */
  gate: Promise<void> | null = null;

  constructor(public products: Product[] = []) {}

  private async track(method: string, args: unknown[]): Promise<void> {
    this.calls.push({ method, args });
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
  }

  async list(query: QueryParams, c: CallContext): Promise<Page<Product>> {
    await this.track('list', [query, c]);
    const ids = query.ids?.split(',');
    return page(ids ? this.products.filter((product) => ids.includes(product.id)) : this.products);
  }

  async getById(id: string, c: CallContext): Promise<Product> {
    await this.track('getById', [id, c]);
    return this.products.find((product) => product.id === id) ?? makeProduct({ id });
  }

  async create(body: unknown, c: CallContext): Promise<Product> {
    await this.track('create', [body, c]);
    return makeProduct(body as Partial<Product>);
  }

  async update(id: string, body: unknown, c: CallContext): Promise<Product> {
    await this.track('update', [id, body, c]);
    return makeProduct({ id, ...(body as Partial<Product>) });
  }

  async remove(id: string, c: CallContext): Promise<void> {
    await this.track('remove', [id, c]);
  }

  async listStockMovements(id: string, query: QueryParams, c: CallContext): Promise<{ items: StockMovement[]; total: number }> {
    await this.track('listStockMovements', [id, query, c]);
    return { items: [], total: 0 };
  }

  async registerStockMovement(id: string, body: unknown, c: CallContext): Promise<StockMovementResult> {
    await this.track('registerStockMovement', [id, body, c]);
    const product = makeProduct({ id });
    return {
      duplicate: false,
      product,
      movement: {
        id: nextId('mov'),
        productId: id,
        type: 'ENTRADA',
        quantity: 1,
        reason: 'teste',
        eventId: null,
        balanceAfter: product.stock,
        createdAt: '2026-11-10T12:00:00.000Z',
      },
    };
  }

  async health(c: CallContext): Promise<void> {
    await this.track('health', [c]);
  }
}

/** ms-pedidos de mentira. */
export class FakeOrdersApi implements OrdersApi {
  calls: Call[] = [];
  failWith: Error | null = null;
  gate: Promise<void> | null = null;
  created: NewOrderPayload[] = [];

  constructor(
    public orders: Order[] = [],
    public events: OutboxItem[] = [],
  ) {}

  private async track(method: string, args: unknown[]): Promise<void> {
    this.calls.push({ method, args });
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
  }

  async list(query: QueryParams, c: CallContext): Promise<Page<Order>> {
    await this.track('list', [query, c]);
    return page(this.orders);
  }

  async getById(id: string, c: CallContext): Promise<Order> {
    await this.track('getById', [id, c]);
    return this.orders.find((order) => order.id === id) ?? makeOrder({ id });
  }

  async create(payload: NewOrderPayload, c: CallContext): Promise<Order> {
    await this.track('create', [payload, c]);
    this.created.push(payload);
    const total = payload.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    return makeOrder({
      customerName: payload.customerName,
      customerEmail: payload.customerEmail,
      notes: payload.notes ?? null,
      items: payload.items.map((item) => ({ ...item, subtotal: item.unitPrice * item.quantity })),
      total,
      itemCount: payload.items.reduce((sum, item) => sum + item.quantity, 0),
    });
  }

  async update(id: string, body: unknown, c: CallContext): Promise<Order> {
    await this.track('update', [id, body, c]);
    return makeOrder({ id, ...(body as Partial<Order>) });
  }

  async changeStatus(id: string, body: unknown, c: CallContext): Promise<Order> {
    await this.track('changeStatus', [id, body, c]);
    return makeOrder({ id, ...(body as Partial<Order>) });
  }

  async remove(id: string, c: CallContext): Promise<void> {
    await this.track('remove', [id, c]);
  }

  async listEvents(query: QueryParams, c: CallContext): Promise<{ items: OutboxItem[]; total: number }> {
    await this.track('listEvents', [query, c]);
    return { items: this.events, total: this.events.length };
  }

  async health(c: CallContext): Promise<void> {
    await this.track('health', [c]);
  }
}

/** Azure Function de mentira. */
export class FakeIndicatorsApi implements IndicatorsApi {
  calls: Array<{ products: Product[]; orders: Order[] }> = [];
  failWith: Error | null = null;
  healthFailWith: Error | null = null;
  result: Indicators = { computedBy: 'azure-function', alerts: [] };

  async calculate(input: { products: Product[]; orders: Order[] }): Promise<Indicators> {
    this.calls.push(input);
    if (this.failWith) throw this.failWith;
    return this.result;
  }

  async health(): Promise<void> {
    if (this.healthFailWith) throw this.healthFailWith;
  }
}
