import { describe, expect, it } from 'vitest';
import { PlaceOrderHandler } from '../../src/application/features/PlaceOrder/PlaceOrder';
import { ConflictError, DomainError, UpstreamError, ValidationError } from '../../src/domain/errors';
import { ctx, FakeOrdersApi, FakeProductsApi, makeProduct } from '../support/fakes';

function setup() {
  const cafe = makeProduct({ id: 'cafe', name: 'Café 500g', price: 24.9, stock: 10 });
  const acucar = makeProduct({ id: 'acucar', name: 'Açúcar 1kg', price: 5.5, stock: 3 });
  const products = new FakeProductsApi([cafe, acucar]);
  const orders = new FakeOrdersApi();
  const handler = new PlaceOrderHandler({ products, orders });
  return { products, orders, handler };
}

const validInput = {
  customerName: 'Ana Souza',
  customerEmail: 'ana@exemplo.com',
  items: [{ productId: 'cafe', quantity: 2 }],
};

describe('PlaceOrder', () => {
  it('cria o pedido com o nome e o preço oficiais, ignorando o que o cliente mandar a mais', async () => {
    const { handler, orders } = setup();

    const result = await handler.handle(
      {
        ...validInput,
        // tentativa de "desconto" pelo navegador: deve ser ignorada
        items: [{ productId: 'cafe', quantity: 2, unitPrice: 0.01, productName: 'Hackeado' }],
      },
      ctx,
    );

    expect(orders.created).toHaveLength(1);
    expect(orders.created[0]?.items).toEqual([
      { productId: 'cafe', productName: 'Café 500g', unitPrice: 24.9, quantity: 2 },
    ]);
    expect(result.order.total).toBeCloseTo(49.8);
    expect(result.stock.mode).toBe('event-driven');
  });

  it('busca no catálogo só os produtos do pedido, sem repetir ids', async () => {
    const { handler, products } = setup();

    await handler.handle(
      {
        ...validInput,
        items: [
          { productId: 'cafe', quantity: 1 },
          { productId: 'acucar', quantity: 1 },
          { productId: 'cafe', quantity: 1 },
        ],
      },
      ctx,
    );

    expect(products.calls[0]?.args[0]).toEqual({ ids: 'cafe,acucar', pageSize: '100' });
  });

  it('soma itens repetidos antes de mandar para o ms-pedidos', async () => {
    const { handler, orders } = setup();

    await handler.handle(
      {
        ...validInput,
        items: [
          { productId: 'cafe', quantity: 1 },
          { productId: 'cafe', quantity: 3 },
        ],
      },
      ctx,
    );

    expect(orders.created[0]?.items).toHaveLength(1);
    expect(orders.created[0]?.items[0]?.quantity).toBe(4);
  });

  it('não cria o pedido quando falta estoque (409 INSUFFICIENT_STOCK)', async () => {
    const { handler, orders } = setup();

    const attempt = handler.handle({ ...validInput, items: [{ productId: 'acucar', quantity: 4 }] }, ctx);

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [{ productId: 'acucar', productName: 'Açúcar 1kg', requested: 4, available: 3 }],
    });
    expect(orders.created).toHaveLength(0);
  });

  it('não cria o pedido quando o produto não existe (422 PRODUCT_NOT_FOUND)', async () => {
    const { handler, orders } = setup();

    const attempt = handler.handle({ ...validInput, items: [{ productId: 'nao-existe', quantity: 1 }] }, ctx);

    await expect(attempt).rejects.toBeInstanceOf(DomainError);
    await expect(attempt).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    expect(orders.created).toHaveLength(0);
  });

  it('valida a entrada antes de chamar qualquer serviço', async () => {
    const { handler, products, orders } = setup();

    const attempt = handler.handle({ customerName: 'A', customerEmail: 'nao-e-email', items: [] }, ctx);

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await attempt.catch((error: ValidationError) => {
      const fields = error.issues.map((issue) => issue.field);
      expect(fields).toEqual(expect.arrayContaining(['customerName', 'customerEmail', 'items']));
    });
    expect(products.calls).toHaveLength(0);
    expect(orders.calls).toHaveLength(0);
  });

  it('recusa quantidade zero, negativa ou quebrada', async () => {
    const { handler } = setup();

    for (const quantity of [0, -1, 1.5, 1000]) {
      await expect(
        handler.handle({ ...validInput, items: [{ productId: 'cafe', quantity }] }, ctx),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('envia as observações só quando foram preenchidas', async () => {
    const { handler, orders } = setup();

    await handler.handle({ ...validInput, notes: '  Entregar à tarde  ' }, ctx);
    await handler.handle({ ...validInput, notes: '   ' }, ctx);

    expect(orders.created[0]?.notes).toBe('Entregar à tarde');
    expect(orders.created[1]).not.toHaveProperty('notes');
  });

  it('propaga a falha do ms-produtos sem tentar criar o pedido', async () => {
    const { handler, products, orders } = setup();
    products.failWith = UpstreamError.unavailable('ms-produtos', 'falha de conexão');

    await expect(handler.handle(validInput, ctx)).rejects.toBeInstanceOf(UpstreamError);
    expect(orders.created).toHaveLength(0);
  });

  it('repassa o correlation-id para os dois serviços', async () => {
    const { handler, products, orders } = setup();

    await handler.handle(validInput, ctx);

    expect(products.calls[0]?.args.at(-1)).toBe(ctx);
    expect(orders.calls[0]?.args.at(-1)).toBe(ctx);
  });
});
