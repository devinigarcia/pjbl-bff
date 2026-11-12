import cors from 'cors';
import express, { Router, type Express, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { CheckHealthHandler } from '../application/features/CheckHealth/CheckHealth';
import type { GetAggregatedDataHandler } from '../application/features/GetAggregatedData/GetAggregatedData';
import type { OrdersProxyHandler } from '../application/features/OrdersProxy/OrdersProxy';
import type { PlaceOrderHandler } from '../application/features/PlaceOrder/PlaceOrder';
import type { ProductsProxyHandler } from '../application/features/ProductsProxy/ProductsProxy';
import { mapCheckHealth } from './features/CheckHealth/CheckHealthEndpoint';
import { mapGetAggregatedData } from './features/GetAggregatedData/GetAggregatedDataEndpoint';
import { mapOrdersProxy } from './features/OrdersProxy/OrdersProxyEndpoint';
import { mapPlaceOrder } from './features/PlaceOrder/PlaceOrderEndpoint';
import { mapProductsProxy } from './features/ProductsProxy/ProductsProxyEndpoint';
import { sendError } from './http';
import { correlationId } from './middlewares/correlationId';
import { errorHandler, notFound } from './middlewares/errorHandler';
import { gatewaySecret } from './middlewares/gatewaySecret';
import { buildOpenApiDocument } from './openapi';

export interface AppDeps {
  handlers: {
    getAggregatedData: GetAggregatedDataHandler;
    placeOrder: PlaceOrderHandler;
    productsProxy: ProductsProxyHandler;
    ordersProxy: OrdersProxyHandler;
    checkHealth: CheckHealthHandler;
  };
  settings: {
    gatewaySecret?: string;
    corsOrigins: string[] | '*';
    rateLimitPerMinute: number;
    trustProxy?: number;
    publicUrl?: string;
    gatewayUrl?: string;
  };
  logger: Logger;
}

const isInfraPath = (path: string) => path === '/health' || path === '/openapi.json' || path.startsWith('/docs');

/**
 * Monta a aplicação Express. Recebe tudo pronto (handlers, configurações, logger):
 * a API não sabe como os handlers foram construídos nem para onde eles ligam.
 */
export function createApp({ handlers, settings, logger }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Na nuvem o BFF fica atrás do ingress do Container Apps; sem isso o rate limit enxergaria só o IP do proxy.
  app.set('trust proxy', settings.trustProxy ?? 1);

  // CSP desligada para o Swagger UI conseguir carregar os próprios scripts.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: settings.corsOrigins === '*' ? '*' : settings.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'x-correlation-id', 'ocp-apim-subscription-key', 'x-gateway-secret'],
      exposedHeaders: ['x-correlation-id', 'server-timing', 'location', 'x-served-by'],
      maxAge: 600,
    }),
  );

  app.use(correlationId());
  app.use((_req, res, next) => {
    res.setHeader('x-served-by', 'pjbl-bff');
    res.setHeader('Timing-Allow-Origin', '*');
    next();
  });

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customProps: (_req, res) => ({ correlationId: (res as Response).locals.correlationId }),
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: settings.rateLimitPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.method === 'OPTIONS' || isInfraPath(req.path),
      handler: (_req, res) => {
        sendError(res, 429, 'RATE_LIMITED', 'Muitas requisições em pouco tempo. Aguarde um instante e tente de novo.');
      },
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(gatewaySecret(settings.gatewaySecret));

  // Documentação
  const document = buildOpenApiDocument({ publicUrl: settings.publicUrl, gatewayUrl: settings.gatewayUrl });
  app.get('/', (_req, res) => res.redirect('/docs'));
  app.get('/openapi.json', (_req, res) => {
    res.json(document);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(document, { customSiteTitle: 'Conecta Store — BFF' }));

  // Um "map" por feature (vertical slice): cada arquivo registra só as rotas da sua feature.
  const router = Router();
  mapCheckHealth(router, handlers.checkHealth);
  mapGetAggregatedData(router, handlers.getAggregatedData);
  mapPlaceOrder(router, handlers.placeOrder);
  mapProductsProxy(router, handlers.productsProxy);
  mapOrdersProxy(router, handlers.ordersProxy);
  app.use(router);

  app.use(notFound());
  app.use(errorHandler(logger));

  return app;
}
