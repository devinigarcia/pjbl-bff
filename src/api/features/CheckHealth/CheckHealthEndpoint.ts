import type { Router } from 'express';
import type { CheckHealthHandler } from '../../../application/features/CheckHealth/CheckHealth';
import { contextOf } from '../../http';

export function mapCheckHealth(router: Router, handler: CheckHealthHandler): void {
  router.get('/health', async (_req, res) => {
    // Sempre 200: se uma dependência caiu o BFF continua vivo (status "degraded"),
    // e a plataforma não deve reiniciar o container por causa disso.
    res.setHeader('Cache-Control', 'no-store');
    res.json(await handler.handle(contextOf(res)));
  });
}
