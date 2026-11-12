import { ConflictError, DomainError } from './errors';
import type { NewOrderPayload, Product } from './models';

export interface RequestedItem {
  productId: string;
  quantity: number;
}

export interface StockShortage {
  productId: string;
  productName: string;
  requested: number;
  available: number;
}

/**
 * Junta linhas repetidas do mesmo produto somando as quantidades.
 * O ms-pedidos não aceita produto repetido, então o BFF já entrega arrumado.
 */
export function mergeRequestedItems(items: RequestedItem[]): RequestedItem[] {
  const byProduct = new Map<string, number>();
  for (const item of items) {
    byProduct.set(item.productId, (byProduct.get(item.productId) ?? 0) + item.quantity);
  }
  return [...byProduct.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Monta os itens do pedido a partir do que o front pediu e do catálogo oficial.
 *
 * O front manda só `productId` e `quantity`. Nome e preço vêm SEMPRE do ms-produtos,
 * assim ninguém consegue criar um pedido com preço alterado no navegador.
 */
export function buildOrderItems(requested: RequestedItem[], catalog: Product[]): NewOrderPayload['items'] {
  const merged = mergeRequestedItems(requested);
  const catalogById = new Map(catalog.map((product) => [product.id, product]));

  const missing = merged.filter((item) => !catalogById.has(item.productId));
  if (missing.length > 0) {
    throw new DomainError(
      'PRODUCT_NOT_FOUND',
      missing.length === 1
        ? 'Um dos produtos do pedido não existe mais no catálogo.'
        : `${missing.length} produtos do pedido não existem mais no catálogo.`,
      missing.map((item) => ({ productId: item.productId })),
    );
  }

  const shortages: StockShortage[] = [];
  const items = merged.map((item) => {
    const product = catalogById.get(item.productId) as Product;
    if (product.stock < item.quantity) {
      shortages.push({
        productId: product.id,
        productName: product.name,
        requested: item.quantity,
        available: product.stock,
      });
    }
    return {
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity: item.quantity,
    };
  });

  if (shortages.length > 0) {
    throw new ConflictError(
      'INSUFFICIENT_STOCK',
      'Estoque insuficiente para um ou mais itens do pedido.',
      shortages,
    );
  }

  return items;
}
