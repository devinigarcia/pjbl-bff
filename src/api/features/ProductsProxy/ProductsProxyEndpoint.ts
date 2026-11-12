import type { Router } from 'express';
import type { ProductsProxyHandler } from '../../../application/features/ProductsProxy/ProductsProxy';
import { contextOf } from '../../http';

export function mapProductsProxy(router: Router, handler: ProductsProxyHandler): void {
  router.get('/products', async (req, res) => {
    res.json(await handler.list(req.query, contextOf(res)));
  });

  router.post('/products', async (req, res) => {
    const product = await handler.create(req.body, contextOf(res));
    res.status(201).location(`/products/${product.id}`).json(product);
  });

  router.get('/products/:id', async (req, res) => {
    res.json(await handler.get(req.params.id, contextOf(res)));
  });

  router.put('/products/:id', async (req, res) => {
    res.json(await handler.update(req.params.id, req.body, contextOf(res)));
  });

  router.delete('/products/:id', async (req, res) => {
    await handler.remove(req.params.id, contextOf(res));
    res.status(204).end();
  });

  router.get('/products/:id/stock-movements', async (req, res) => {
    res.json(await handler.listStockMovements(req.params.id, req.query, contextOf(res)));
  });

  router.post('/products/:id/stock-movements', async (req, res) => {
    const result = await handler.registerStockMovement(req.params.id, req.body, contextOf(res));
    // 200 quando o ms-produtos reconheceu um eventId repetido; 201 quando aplicou de fato.
    res.status(result.duplicate ? 200 : 201).json(result);
  });
}
