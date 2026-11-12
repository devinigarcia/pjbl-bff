import { z } from 'zod';
import type { Order } from '../../../domain/models';
import { buildOrderItems } from '../../../domain/orderDraft';
import type { CallContext } from '../../ports/CallContext';
import type { OrdersApi } from '../../ports/OrdersApi';
import type { ProductsApi } from '../../ports/ProductsApi';
import { validate } from '../../validation';

export const placeOrderSchema = z.object({
  customerName: z
    .string({ required_error: 'Informe o nome do cliente.' })
    .trim()
    .min(2, 'O nome precisa ter pelo menos 2 caracteres.')
    .max(120, 'O nome pode ter no máximo 120 caracteres.'),
  customerEmail: z
    .string({ required_error: 'Informe o e-mail do cliente.' })
    .trim()
    .email('E-mail inválido.')
    .max(160, 'O e-mail pode ter no máximo 160 caracteres.'),
  notes: z.string().trim().max(500, 'As observações podem ter no máximo 500 caracteres.').optional(),
  items: z
    .array(
      z.object({
        productId: z.string({ required_error: 'Informe o produto.' }).trim().min(1, 'Informe o produto.'),
        quantity: z
          .number({ required_error: 'Informe a quantidade.', invalid_type_error: 'A quantidade deve ser um número.' })
          .int('A quantidade deve ser um número inteiro.')
          .min(1, 'A quantidade mínima é 1.')
          .max(999, 'A quantidade máxima é 999.'),
      }),
      { required_error: 'Informe os itens do pedido.' },
    )
    .min(1, 'O pedido precisa de pelo menos 1 item.')
    .max(20, 'O pedido pode ter no máximo 20 itens.'),
});

export interface PlaceOrderResult {
  order: Order;
  stock: { mode: 'event-driven'; message: string };
}

interface Deps {
  products: ProductsApi;
  orders: OrdersApi;
}

/**
 * POST /orders orquestrado.
 *
 * O front manda só produto e quantidade. O BFF consulta o catálogo, usa o nome e o
 * preço oficiais, confere o estoque e só então cria o pedido no ms-pedidos.
 * A baixa do estoque NÃO acontece aqui: ela é feita depois, pelo evento `order.created`.
 */
export class PlaceOrderHandler {
  constructor(private readonly deps: Deps) {}

  async handle(input: unknown, ctx: CallContext): Promise<PlaceOrderResult> {
    const command = validate(placeOrderSchema, input);

    const ids = [...new Set(command.items.map((item) => item.productId))];
    const catalog = await this.deps.products.list({ ids: ids.join(','), pageSize: '100' }, ctx);

    const items = buildOrderItems(command.items, catalog.items);

    const order = await this.deps.orders.create(
      {
        customerName: command.customerName,
        customerEmail: command.customerEmail,
        ...(command.notes ? { notes: command.notes } : {}),
        items,
      },
      ctx,
    );

    return {
      order,
      stock: {
        mode: 'event-driven',
        message:
          'Pedido criado. A baixa de estoque é assíncrona: o ms-pedidos publica o evento order.created ' +
          'e a Azure Function registra a saída no ms-produtos em alguns segundos.',
      },
    };
  }
}
