import type { Router } from 'express';
import type { PlaceOrderHandler } from '../../../application/features/PlaceOrder/PlaceOrder';
import { contextOf } from '../../http';

export function mapPlaceOrder(router: Router, handler: PlaceOrderHandler): void {
  router.post('/orders', async (req, res) => {
    const result = await handler.handle(req.body, contextOf(res));

    res.status(201).location(`/orders/${result.order.id}`).json(result);
  });
}
