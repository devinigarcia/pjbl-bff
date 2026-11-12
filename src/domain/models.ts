// Formatos que trafegam pelo BFF. São os mesmos contratos dos microserviços
// (ver pjbl-arquitetura/docs/contratos.md); o BFF não tem banco próprio.

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  type: 'ENTRADA' | 'SAIDA';
  quantity: number;
  reason: string;
  eventId: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface StockMovementResult {
  movement: StockMovement;
  product: Product;
  duplicate: boolean;
}

export type OrderStatus = 'PENDENTE' | 'PAGO' | 'ENVIADO' | 'ENTREGUE' | 'CANCELADO';

export interface OrderItem {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  subtotal?: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  itemCount: number;
  notes: string | null;
  allowedTransitions: OrderStatus[];
  createdAt: string;
  updatedAt: string;
}

/** Item do outbox do ms-pedidos (evento publicado, pendente ou com falha). */
export interface OutboxItem {
  id: string;
  type: string;
  aggregateId: string;
  occurredAt: string;
  processedAt: string | null;
  attempts: number;
  lastError: string | null;
  status: 'PUBLICADO' | 'PENDENTE' | 'FALHOU';
  payload: unknown;
}

/** Resposta da Azure Function. O BFF só repassa, então não amarramos campo a campo. */
export type Indicators = Record<string, unknown>;

/** O que o ms-pedidos espera receber para criar um pedido. */
export interface NewOrderPayload {
  customerName: string;
  customerEmail: string;
  notes?: string;
  items: Array<{ productId: string; productName: string; unitPrice: number; quantity: number }>;
}
