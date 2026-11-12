import { describe, expect, it } from 'vitest';
import { ConflictError, DomainError } from '../../src/domain/errors';
import { buildOrderItems, mergeRequestedItems } from '../../src/domain/orderDraft';
import { makeProduct } from '../support/fakes';

describe('orderDraft (regras de montagem do pedido)', () => {
  const cafe = makeProduct({ id: 'cafe', name: 'Café 500g', price: 24.9, stock: 10 });
  const acucar = makeProduct({ id: 'acucar', name: 'Açúcar 1kg', price: 5.5, stock: 3 });

  it('soma as quantidades quando o mesmo produto aparece mais de uma vez', () => {
    const merged = mergeRequestedItems([
      { productId: 'cafe', quantity: 1 },
      { productId: 'acucar', quantity: 2 },
      { productId: 'cafe', quantity: 3 },
    ]);

    expect(merged).toEqual([
      { productId: 'cafe', quantity: 4 },
      { productId: 'acucar', quantity: 2 },
    ]);
  });

  it('usa o nome e o preço oficiais do catálogo', () => {
    const items = buildOrderItems([{ productId: 'cafe', quantity: 2 }], [cafe, acucar]);

    expect(items).toEqual([{ productId: 'cafe', productName: 'Café 500g', unitPrice: 24.9, quantity: 2 }]);
  });

  it('aceita pedir exatamente o que tem em estoque', () => {
    const items = buildOrderItems([{ productId: 'acucar', quantity: 3 }], [acucar]);

    expect(items[0]?.quantity).toBe(3);
  });

  it('recusa produto que não existe no catálogo (PRODUCT_NOT_FOUND)', () => {
    const attempt = () => buildOrderItems([{ productId: 'fantasma', quantity: 1 }], [cafe]);

    expect(attempt).toThrow(DomainError);
    try {
      attempt();
    } catch (error) {
      expect((error as DomainError).code).toBe('PRODUCT_NOT_FOUND');
      expect((error as DomainError).details).toEqual([{ productId: 'fantasma' }]);
    }
  });

  it('recusa quando falta estoque e diz quanto foi pedido e quanto tem', () => {
    const attempt = () =>
      buildOrderItems(
        [
          { productId: 'cafe', quantity: 2 },
          { productId: 'acucar', quantity: 5 },
        ],
        [cafe, acucar],
      );

    expect(attempt).toThrow(ConflictError);
    try {
      attempt();
    } catch (error) {
      expect((error as ConflictError).code).toBe('INSUFFICIENT_STOCK');
      expect((error as ConflictError).details).toEqual([
        { productId: 'acucar', productName: 'Açúcar 1kg', requested: 5, available: 3 },
      ]);
    }
  });

  it('considera a soma das linhas repetidas na hora de conferir o estoque', () => {
    const attempt = () =>
      buildOrderItems(
        [
          { productId: 'acucar', quantity: 2 },
          { productId: 'acucar', quantity: 2 },
        ],
        [acucar],
      );

    expect(attempt).toThrow(/Estoque insuficiente/);
  });
});
