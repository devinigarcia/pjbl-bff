// Composition root: é o único arquivo que conhece ao mesmo tempo a infraestrutura
// (clientes HTTP, config, logger) e a API (Express). Todo o resto recebe as dependências prontas.
import { createApp } from './api/app';
import { CheckHealthHandler } from './application/features/CheckHealth/CheckHealth';
import { GetAggregatedDataHandler } from './application/features/GetAggregatedData/GetAggregatedData';
import { OrdersProxyHandler } from './application/features/OrdersProxy/OrdersProxy';
import { PlaceOrderHandler } from './application/features/PlaceOrder/PlaceOrder';
import { ProductsProxyHandler } from './application/features/ProductsProxy/ProductsProxy';
import { loadConfig, loadDotEnv } from './infrastructure/config';
import { HttpJsonClient } from './infrastructure/http/HttpJsonClient';
import { IndicatorsFunctionApi } from './infrastructure/http/IndicatorsFunctionApi';
import { PedidosHttpApi } from './infrastructure/http/PedidosHttpApi';
import { ProdutosHttpApi } from './infrastructure/http/ProdutosHttpApi';
import { createLogger } from './infrastructure/logger';

function bootstrap(): void {
  loadDotEnv();
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const keyHeader = (name: string, value: string | undefined): Record<string, string> =>
    value ? { [name]: value } : {};

  const products = new ProdutosHttpApi(
    new HttpJsonClient({
      service: 'ms-produtos',
      baseUrl: config.produtosApiUrl,
      timeoutMs: config.upstreamTimeoutMs,
      defaultHeaders: keyHeader('x-api-key', config.produtosApiKey),
      logger,
    }),
  );

  const orders = new PedidosHttpApi(
    new HttpJsonClient({
      service: 'ms-pedidos',
      baseUrl: config.pedidosApiUrl,
      timeoutMs: config.upstreamTimeoutMs,
      defaultHeaders: keyHeader('x-api-key', config.pedidosApiKey),
      logger,
    }),
  );

  // Sem FUNCTION_URL o BFF continua funcionando; o /aggregated-data só marca a Function como "skipped".
  const indicators = config.functionUrl
    ? new IndicatorsFunctionApi(
        new HttpJsonClient({
          service: 'azure-function',
          baseUrl: config.functionUrl,
          timeoutMs: config.upstreamTimeoutMs,
          defaultHeaders: keyHeader('x-functions-key', config.functionKey),
          logger,
        }),
      )
    : null;

  const app = createApp({
    handlers: {
      getAggregatedData: new GetAggregatedDataHandler({ products, orders, indicators }),
      placeOrder: new PlaceOrderHandler({ products, orders }),
      productsProxy: new ProductsProxyHandler({ products }),
      ordersProxy: new OrdersProxyHandler({ orders }),
      checkHealth: new CheckHealthHandler({ products, orders, indicators }),
    },
    settings: {
      gatewaySecret: config.gatewaySecret,
      corsOrigins: config.corsOrigins,
      rateLimitPerMinute: config.rateLimitPerMinute,
      trustProxy: config.trustProxy,
      publicUrl: config.publicUrl,
      gatewayUrl: config.gatewayUrl,
    },
    logger,
  });

  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        msProdutos: config.produtosApiUrl,
        msPedidos: config.pedidosApiUrl,
        azureFunction: config.functionUrl ?? 'não configurada',
        gatewaySecret: config.gatewaySecret ? 'exigido' : 'desligado',
      },
      `BFF no ar — documentação em http://localhost:${config.port}/docs`,
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'encerrando o BFF');
    server.close(() => process.exit(0));
    // se alguma conexão ficar presa, não segura o container para sempre
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  bootstrap();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
