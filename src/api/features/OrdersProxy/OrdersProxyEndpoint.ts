import type { Router } from 'express';
import type { OrdersProxyHandler } from '../../../application/features/OrdersProxy/OrdersProxy';
import { contextOf } from '../../http';

export function mapOrdersProxy(router: Router, handler: OrdersProxyHandler): void {
  router.get('/orders', async (req, res) => {
    res.json(await handler.list(req.query, contextOf(res)));
  });

  router.get('/orders/:id', async (req, res) => {
    res.json(await handler.get(req.params.id, contextOf(res)));
  });

  router.put('/orders/:id', async (req, res) => {
    res.json(await handler.update(req.params.id, req.body, contextOf(res)));
  });

  router.patch('/orders/:id/status', async (req, res) => {
    res.json(await handler.changeStatus(req.params.id, req.body, contextOf(res)));
  });

  router.delete('/orders/:id', async (req, res) => {
    await handler.remove(req.params.id, contextOf(res));
    res.status(204).end();
  });

  // Eventos do outbox do ms-pedidos (publicados, pendentes e com falha).
  router.get('/events', async (req, res) => {
    res.json(await handler.listEvents(req.query, contextOf(res)));
  });
}
