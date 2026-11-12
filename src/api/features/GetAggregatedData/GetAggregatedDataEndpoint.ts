import type { Router } from 'express';
import type {
  AggregatedData,
  GetAggregatedDataHandler,
} from '../../../application/features/GetAggregatedData/GetAggregatedData';
import { contextOf } from '../../http';

/**
 * Monta o cabeçalho Server-Timing com o tempo de cada fonte.
 * Aparece na aba Network do navegador e o front também mostra no painel de chamadas.
 */
export function buildServerTiming(data: Pick<AggregatedData, 'sources' | 'totalDurationMs'>): string {
  const { msProdutos, msPedidos, azureFunction } = data.sources;
  return [
    `ms-produtos;dur=${msProdutos.durationMs}`,
    `ms-pedidos;dur=${msPedidos.durationMs}`,
    `azure-function;dur=${azureFunction.durationMs}`,
    `total;dur=${data.totalDurationMs}`,
  ].join(', ');
}

export function mapGetAggregatedData(router: Router, handler: GetAggregatedDataHandler): void {
  router.get('/aggregated-data', async (_req, res) => {
    const data = await handler.handle(contextOf(res));

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Server-Timing', buildServerTiming(data));
    res.json(data);
  });
}
