// Documento OpenAPI 3 do BFF. Montado na mão (sem decorators) para ficar fácil de ler
// e porque o mesmo JSON é importado no API Gateway para criar as rotas de lá.

interface OpenApiOptions {
  publicUrl?: string;
  gatewayUrl?: string;
}

type Json = Record<string, unknown>;

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

const jsonBody = (schema: Json, example?: unknown): Json => ({
  required: true,
  content: { 'application/json': { schema, ...(example !== undefined ? { example } : {}) } },
});

const jsonResponse = (description: string, schema: Json, example?: unknown): Json => ({
  description,
  content: { 'application/json': { schema, ...(example !== undefined ? { example } : {}) } },
});

const errorResponse = (description: string, code: string, message: string, details?: unknown): Json =>
  jsonResponse(description, ref('Error'), {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      correlationId: '0b0f3c0e-6c1f-4f5e-9f4e-2f6f1d6f9a11',
    },
  });

const idParam = (what: string): Json => ({
  name: 'id',
  in: 'path',
  required: true,
  description: `Identificador (UUID) ${what}.`,
  schema: { type: 'string' },
});

const queryParam = (name: string, description: string, schema: Json): Json => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
});

const unavailable = errorResponse(
  'O microserviço de trás está fora do ar ou respondeu com erro.',
  'UPSTREAM_UNAVAILABLE',
  'O serviço ms-produtos está indisponível no momento (falha de conexão).',
  { service: 'ms-produtos' },
);

const unauthorized = errorResponse(
  'Requisição não veio pelo API Gateway (só acontece quando GATEWAY_SECRET está ligado).',
  'UNAUTHORIZED',
  'Acesso permitido somente pelo API Gateway.',
);

const validation = errorResponse('Dados inválidos.', 'VALIDATION_ERROR', 'Dados inválidos.', [
  { field: 'price', message: 'O preço deve ser maior que zero.' },
]);

const common = { '401': unauthorized, '502': unavailable };

const productExample = {
  id: '5f0c8a52-6a57-4a0e-9d55-0d3c1f1a7b21',
  sku: 'CAFE-500G',
  name: 'Café torrado e moído 500g',
  description: 'Torra média, embalagem a vácuo.',
  category: 'Mercearia',
  price: 24.9,
  stock: 12,
  lowStock: false,
  createdAt: '2026-11-10T13:00:00.000Z',
  updatedAt: '2026-11-10T13:00:00.000Z',
};

const orderExample = {
  id: '9d2b7a1e-3f44-4c0c-8a51-7f1e2d3c4b5a',
  customerName: 'Ana Souza',
  customerEmail: 'ana.souza@exemplo.com',
  status: 'PENDENTE',
  items: [
    {
      productId: productExample.id,
      productName: productExample.name,
      unitPrice: 24.9,
      quantity: 2,
      subtotal: 49.8,
    },
  ],
  total: 49.8,
  itemCount: 2,
  notes: null,
  allowedTransitions: ['PAGO', 'CANCELADO'],
  createdAt: '2026-11-10T13:05:00.000Z',
  updatedAt: '2026-11-10T13:05:00.000Z',
};

const outboxExample = {
  id: 'c1a5c1f0-0f0e-4a55-b7a0-1d2e3f4a5b6c',
  type: 'order.created',
  aggregateId: orderExample.id,
  occurredAt: '2026-11-10T13:05:00.000Z',
  processedAt: '2026-11-10T13:05:02.100Z',
  attempts: 1,
  lastError: null,
  status: 'PUBLICADO',
  payload: {
    eventId: 'c1a5c1f0-0f0e-4a55-b7a0-1d2e3f4a5b6c',
    type: 'order.created',
    version: 1,
    source: 'ms-pedidos',
    occurredAt: '2026-11-10T13:05:00.000Z',
    correlationId: '0b0f3c0e-6c1f-4f5e-9f4e-2f6f1d6f9a11',
    data: {
      orderId: orderExample.id,
      customerName: 'Ana Souza',
      customerEmail: 'ana.souza@exemplo.com',
      status: 'PENDENTE',
      total: 49.8,
      items: [{ productId: productExample.id, productName: productExample.name, quantity: 2, unitPrice: 24.9 }],
    },
  },
};

const indicatorsExample = {
  products: {
    total: 8,
    totalUnitsInStock: 120,
    inventoryValue: 3500.5,
    lowStock: [{ id: productExample.id, sku: 'CAFE-500G', name: productExample.name, stock: 3 }],
    outOfStock: 1,
    byCategory: [{ category: 'Mercearia', count: 3, units: 40, value: 900 }],
  },
  orders: {
    total: 5,
    byStatus: { PENDENTE: 1, PAGO: 1, ENVIADO: 1, ENTREGUE: 1, CANCELADO: 1 },
    revenue: 300,
    averageTicket: 100,
    pendingValue: 49.8,
    cancellationRate: 0.2,
  },
  topProducts: [{ productId: productExample.id, productName: productExample.name, quantity: 7, revenue: 174.3 }],
  alerts: ['1 produto está com estoque baixo.'],
  generatedAt: '2026-11-10T13:10:00.120Z',
  computedBy: 'azure-function',
};

const aggregatedExample = {
  generatedAt: '2026-11-10T13:10:00.180Z',
  correlationId: '0b0f3c0e-6c1f-4f5e-9f4e-2f6f1d6f9a11',
  partial: false,
  totalDurationMs: 180,
  products: { items: [productExample], total: 1 },
  orders: { items: [orderExample], total: 1 },
  recentEvents: [outboxExample],
  indicators: indicatorsExample,
  sources: {
    msProdutos: { status: 'ok', durationMs: 40 },
    msPedidos: { status: 'ok', durationMs: 55 },
    azureFunction: { status: 'ok', durationMs: 90 },
  },
};

function buildSchemas(): Json {
  const orderStatus = { type: 'string', enum: ['PENDENTE', 'PAGO', 'ENVIADO', 'ENTREGUE', 'CANCELADO'] };

  return {
    Error: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message', 'correlationId'],
          properties: {
            code: { type: 'string', description: 'Código fixo do erro, bom para tratar no front.' },
            message: { type: 'string', description: 'Mensagem em português para mostrar ao usuário.' },
            details: { description: 'Detalhes do erro (campos inválidos, itens sem estoque etc.).' },
            correlationId: { type: 'string' },
          },
        },
      },
    },
    Product: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        sku: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        price: { type: 'number' },
        stock: { type: 'integer' },
        lowStock: { type: 'boolean', description: 'true quando o estoque está em 5 unidades ou menos.' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      example: productExample,
    },
    ProductInput: {
      type: 'object',
      required: ['sku', 'name', 'category', 'price'],
      properties: {
        sku: { type: 'string', description: 'Código do produto. Letras maiúsculas, números e hífen (3 a 30).' },
        name: { type: 'string', minLength: 2, maxLength: 120 },
        description: { type: 'string' },
        category: { type: 'string' },
        price: { type: 'number', description: 'Maior que zero, com até 2 casas.' },
        stock: { type: 'integer', minimum: 0, description: 'Estoque inicial (vira uma movimentação de ENTRADA).' },
      },
    },
    ProductUpdate: {
      type: 'object',
      required: ['name', 'category', 'price'],
      properties: {
        sku: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        price: { type: 'number' },
      },
      description: 'O estoque não é alterado por aqui — só por movimentação.',
    },
    ProductPage: {
      type: 'object',
      properties: {
        items: { type: 'array', items: ref('Product') },
        total: { type: 'integer' },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
      },
    },
    StockMovement: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        productId: { type: 'string' },
        type: { type: 'string', enum: ['ENTRADA', 'SAIDA'] },
        quantity: { type: 'integer' },
        reason: { type: 'string' },
        eventId: { type: 'string', nullable: true, description: 'Preenchido quando a movimentação veio de um evento de pedido.' },
        balanceAfter: { type: 'integer', description: 'Saldo do produto logo depois da movimentação.' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    StockMovementInput: {
      type: 'object',
      required: ['type', 'quantity'],
      properties: {
        type: { type: 'string', enum: ['ENTRADA', 'SAIDA'] },
        quantity: { type: 'integer', minimum: 1 },
        reason: { type: 'string' },
        eventId: { type: 'string', description: 'Chave de idempotência (opcional).' },
      },
    },
    StockMovementResult: {
      type: 'object',
      properties: {
        movement: ref('StockMovement'),
        product: ref('Product'),
        duplicate: { type: 'boolean' },
      },
    },
    StockMovementList: {
      type: 'object',
      properties: { items: { type: 'array', items: ref('StockMovement') }, total: { type: 'integer' } },
    },
    OrderItem: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        productName: { type: 'string' },
        unitPrice: { type: 'number' },
        quantity: { type: 'integer' },
        subtotal: { type: 'number' },
      },
    },
    Order: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        customerName: { type: 'string' },
        customerEmail: { type: 'string' },
        status: orderStatus,
        items: { type: 'array', items: ref('OrderItem') },
        total: { type: 'number' },
        itemCount: { type: 'integer' },
        notes: { type: 'string', nullable: true },
        allowedTransitions: { type: 'array', items: orderStatus, description: 'Próximos status permitidos.' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      example: orderExample,
    },
    OrderPage: {
      type: 'object',
      properties: {
        items: { type: 'array', items: ref('Order') },
        total: { type: 'integer' },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
      },
    },
    PlaceOrderInput: {
      type: 'object',
      required: ['customerName', 'customerEmail', 'items'],
      properties: {
        customerName: { type: 'string', minLength: 2, maxLength: 120 },
        customerEmail: { type: 'string', format: 'email' },
        notes: { type: 'string', maxLength: 500 },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            required: ['productId', 'quantity'],
            properties: {
              productId: { type: 'string' },
              quantity: { type: 'integer', minimum: 1, maximum: 999 },
            },
          },
        },
      },
    },
    PlaceOrderResult: {
      type: 'object',
      properties: {
        order: ref('Order'),
        stock: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['event-driven'] },
            message: { type: 'string' },
          },
        },
      },
    },
    OrderUpdate: {
      type: 'object',
      required: ['customerName', 'customerEmail'],
      properties: {
        customerName: { type: 'string' },
        customerEmail: { type: 'string', format: 'email' },
        notes: { type: 'string' },
      },
    },
    ChangeStatusInput: {
      type: 'object',
      required: ['status'],
      properties: { status: orderStatus },
    },
    OutboxItem: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: ['order.created', 'order.cancelled'] },
        aggregateId: { type: 'string', description: 'Id do pedido que gerou o evento.' },
        occurredAt: { type: 'string', format: 'date-time' },
        processedAt: { type: 'string', format: 'date-time', nullable: true },
        attempts: { type: 'integer' },
        lastError: { type: 'string', nullable: true },
        status: { type: 'string', enum: ['PUBLICADO', 'PENDENTE', 'FALHOU'] },
        payload: { type: 'object', description: 'Evento completo, como foi para a fila.' },
      },
      example: outboxExample,
    },
    OutboxList: {
      type: 'object',
      properties: { items: { type: 'array', items: ref('OutboxItem') }, total: { type: 'integer' } },
    },
    SourceReport: {
      type: 'object',
      required: ['status', 'durationMs'],
      properties: {
        status: { type: 'string', enum: ['ok', 'error', 'skipped'] },
        durationMs: { type: 'integer' },
        error: { type: 'string', description: 'Motivo, quando o status não é "ok".' },
      },
    },
    Indicators: {
      type: 'object',
      description: 'Indicadores calculados pela Azure Function (HTTP Trigger calculateIndicators).',
      example: indicatorsExample,
    },
    AggregatedData: {
      type: 'object',
      properties: {
        generatedAt: { type: 'string', format: 'date-time' },
        correlationId: { type: 'string' },
        partial: { type: 'boolean', description: 'true quando alguma fonte falhou ou foi pulada.' },
        totalDurationMs: { type: 'integer' },
        products: {
          type: 'object',
          nullable: true,
          properties: { items: { type: 'array', items: ref('Product') }, total: { type: 'integer' } },
        },
        orders: {
          type: 'object',
          nullable: true,
          properties: { items: { type: 'array', items: ref('Order') }, total: { type: 'integer' } },
        },
        recentEvents: { type: 'array', items: ref('OutboxItem') },
        indicators: { allOf: [ref('Indicators')], nullable: true },
        sources: {
          type: 'object',
          properties: {
            msProdutos: ref('SourceReport'),
            msPedidos: ref('SourceReport'),
            azureFunction: ref('SourceReport'),
          },
        },
      },
      example: aggregatedExample,
    },
    Health: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded'] },
        service: { type: 'string', example: 'pjbl-bff' },
        dependencies: {
          type: 'object',
          properties: {
            msProdutos: ref('SourceReport'),
            msPedidos: ref('SourceReport'),
            azureFunction: ref('SourceReport'),
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  };
}

function buildPaths(): Json {
  const productNotFound = errorResponse('Produto não encontrado.', 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
  const orderNotFound = errorResponse('Pedido não encontrado.', 'ORDER_NOT_FOUND', 'Pedido não encontrado.');

  return {
    '/aggregated-data': {
      get: {
        tags: ['Agregação'],
        operationId: 'getAggregatedData',
        summary: 'Dados agregados dos dois microserviços e da Azure Function',
        description:
          'Endpoint obrigatório do projeto. Consulta **ms-produtos** e **ms-pedidos** em paralelo, envia o resultado ' +
          'para a **Azure Function** calcular os indicadores e devolve tudo em **um único JSON**.\n\n' +
          'Se uma das fontes falhar, a resposta continua sendo 200, com `partial: true` e o bloco daquela fonte como `null`. ' +
          'O cabeçalho `Server-Timing` traz o tempo gasto em cada fonte.',
        responses: {
          '200': {
            ...jsonResponse('Dados agregados (completos ou parciais).', ref('AggregatedData')),
            headers: {
              'Server-Timing': {
                description: 'Tempo por fonte. Ex.: `ms-produtos;dur=40, ms-pedidos;dur=55, azure-function;dur=90, total;dur=180`',
                schema: { type: 'string' },
              },
              'x-correlation-id': { description: 'Id para rastrear a chamada nos logs.', schema: { type: 'string' } },
            },
          },
          '401': unauthorized,
        },
      },
    },
    '/products': {
      get: {
        tags: ['Produtos'],
        operationId: 'listProducts',
        summary: 'Lista produtos (proxy para o ms-produtos)',
        parameters: [
          queryParam('search', 'Busca por nome ou SKU.', { type: 'string' }),
          queryParam('category', 'Filtra por categoria.', { type: 'string' }),
          queryParam('ids', 'Lista de ids separados por vírgula.', { type: 'string' }),
          queryParam('page', 'Página (começa em 1).', { type: 'integer', minimum: 1, default: 1 }),
          queryParam('pageSize', 'Itens por página (máx. 100).', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
        ],
        responses: { '200': jsonResponse('Página de produtos.', ref('ProductPage')), '400': validation, ...common },
      },
      post: {
        tags: ['Produtos'],
        operationId: 'createProduct',
        summary: 'Cadastra um produto',
        requestBody: jsonBody(ref('ProductInput'), {
          sku: 'CAFE-500G',
          name: 'Café torrado e moído 500g',
          description: 'Torra média, embalagem a vácuo.',
          category: 'Mercearia',
          price: 24.9,
          stock: 12,
        }),
        responses: {
          '201': jsonResponse('Produto criado.', ref('Product')),
          '400': validation,
          '409': errorResponse('SKU já cadastrado.', 'SKU_ALREADY_EXISTS', 'Já existe um produto com o SKU CAFE-500G.'),
          ...common,
        },
      },
    },
    '/products/{id}': {
      get: {
        tags: ['Produtos'],
        operationId: 'getProduct',
        summary: 'Busca um produto pelo id',
        parameters: [idParam('do produto')],
        responses: { '200': jsonResponse('Produto.', ref('Product')), '404': productNotFound, ...common },
      },
      put: {
        tags: ['Produtos'],
        operationId: 'updateProduct',
        summary: 'Atualiza os dados de um produto (não mexe no estoque)',
        parameters: [idParam('do produto')],
        requestBody: jsonBody(ref('ProductUpdate'), {
          name: 'Café torrado e moído 500g',
          description: 'Torra média.',
          category: 'Mercearia',
          price: 26.5,
        }),
        responses: {
          '200': jsonResponse('Produto atualizado.', ref('Product')),
          '400': validation,
          '404': productNotFound,
          ...common,
        },
      },
      delete: {
        tags: ['Produtos'],
        operationId: 'deleteProduct',
        summary: 'Exclui um produto e o histórico de movimentações dele',
        parameters: [idParam('do produto')],
        responses: { '204': { description: 'Produto excluído.' }, '404': productNotFound, ...common },
      },
    },
    '/products/{id}/stock-movements': {
      get: {
        tags: ['Produtos'],
        operationId: 'listStockMovements',
        summary: 'Histórico de movimentações de estoque do produto',
        parameters: [
          idParam('do produto'),
          queryParam('limit', 'Quantidade máxima (máx. 200).', { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
        ],
        responses: { '200': jsonResponse('Movimentações.', ref('StockMovementList')), '404': productNotFound, ...common },
      },
      post: {
        tags: ['Produtos'],
        operationId: 'registerStockMovement',
        summary: 'Registra uma entrada ou saída manual de estoque',
        description:
          'O estoque só muda por movimentação. As baixas dos pedidos NÃO passam por aqui: elas chegam pelo evento ' +
          '`order.created`, consumido pela Azure Function.',
        parameters: [idParam('do produto')],
        requestBody: jsonBody(ref('StockMovementInput'), { type: 'ENTRADA', quantity: 10, reason: 'Reposição do fornecedor' }),
        responses: {
          '201': jsonResponse('Movimentação aplicada.', ref('StockMovementResult')),
          '200': jsonResponse('Movimentação repetida (mesmo eventId), nada foi alterado.', ref('StockMovementResult')),
          '400': validation,
          '404': productNotFound,
          '409': errorResponse('Saída maior que o saldo.', 'INSUFFICIENT_STOCK', 'Estoque insuficiente: saldo atual 3.'),
          ...common,
        },
      },
    },
    '/orders': {
      get: {
        tags: ['Pedidos'],
        operationId: 'listOrders',
        summary: 'Lista pedidos (proxy para o ms-pedidos)',
        parameters: [
          queryParam('status', 'Filtra por status.', { type: 'string', enum: ['PENDENTE', 'PAGO', 'ENVIADO', 'ENTREGUE', 'CANCELADO'] }),
          queryParam('search', 'Busca por nome ou e-mail do cliente.', { type: 'string' }),
          queryParam('page', 'Página (começa em 1).', { type: 'integer', minimum: 1, default: 1 }),
          queryParam('pageSize', 'Itens por página (máx. 100).', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
        ],
        responses: { '200': jsonResponse('Página de pedidos.', ref('OrderPage')), '400': validation, ...common },
      },
      post: {
        tags: ['Pedidos'],
        operationId: 'placeOrder',
        summary: 'Cria um pedido (orquestrado pelo BFF)',
        description:
          'O front envia só `productId` e `quantity`. O BFF:\n\n' +
          '1. busca os produtos no **ms-produtos** e usa o **nome e o preço oficiais**;\n' +
          '2. soma itens repetidos e confere o estoque;\n' +
          '3. cria o pedido no **ms-pedidos**.\n\n' +
          'A baixa do estoque é **assíncrona**: o ms-pedidos publica o evento `order.created` e a Azure Function ' +
          'registra a saída no ms-produtos.',
        requestBody: jsonBody(ref('PlaceOrderInput'), {
          customerName: 'Ana Souza',
          customerEmail: 'ana.souza@exemplo.com',
          notes: 'Entregar no período da tarde.',
          items: [{ productId: productExample.id, quantity: 2 }],
        }),
        responses: {
          '201': jsonResponse('Pedido criado.', ref('PlaceOrderResult')),
          '400': validation,
          '409': errorResponse('Estoque insuficiente.', 'INSUFFICIENT_STOCK', 'Estoque insuficiente para um ou mais itens do pedido.', [
            { productId: productExample.id, productName: productExample.name, requested: 20, available: 12 },
          ]),
          '422': errorResponse('Produto não existe mais.', 'PRODUCT_NOT_FOUND', 'Um dos produtos do pedido não existe mais no catálogo.', [
            { productId: '00000000-0000-4000-8000-000000000000' },
          ]),
          ...common,
        },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Pedidos'],
        operationId: 'getOrder',
        summary: 'Busca um pedido pelo id',
        parameters: [idParam('do pedido')],
        responses: { '200': jsonResponse('Pedido.', ref('Order')), '404': orderNotFound, ...common },
      },
      put: {
        tags: ['Pedidos'],
        operationId: 'updateOrder',
        summary: 'Atualiza os dados do cliente (só com o pedido PENDENTE)',
        parameters: [idParam('do pedido')],
        requestBody: jsonBody(ref('OrderUpdate'), {
          customerName: 'Ana Souza Lima',
          customerEmail: 'ana.lima@exemplo.com',
          notes: 'Ligar antes de entregar.',
        }),
        responses: {
          '200': jsonResponse('Pedido atualizado.', ref('Order')),
          '400': validation,
          '404': orderNotFound,
          '409': errorResponse('Pedido não está mais PENDENTE.', 'ORDER_NOT_EDITABLE', 'Só é possível editar pedidos pendentes.'),
          ...common,
        },
      },
      delete: {
        tags: ['Pedidos'],
        operationId: 'deleteOrder',
        summary: 'Exclui um pedido (só se estiver CANCELADO)',
        parameters: [idParam('do pedido')],
        responses: {
          '204': { description: 'Pedido excluído.' },
          '404': orderNotFound,
          '409': errorResponse('Pedido não está cancelado.', 'ORDER_NOT_DELETABLE', 'Só é possível excluir pedidos cancelados.'),
          ...common,
        },
      },
    },
    '/orders/{id}/status': {
      patch: {
        tags: ['Pedidos'],
        operationId: 'changeOrderStatus',
        summary: 'Muda o status do pedido',
        description:
          'Transições válidas: `PENDENTE → PAGO | CANCELADO`, `PAGO → ENVIADO | CANCELADO`, `ENVIADO → ENTREGUE`. ' +
          'Cancelar gera o evento `order.cancelled`, que devolve os itens ao estoque.',
        parameters: [idParam('do pedido')],
        requestBody: jsonBody(ref('ChangeStatusInput'), { status: 'PAGO' }),
        responses: {
          '200': jsonResponse('Pedido com o novo status.', ref('Order')),
          '400': validation,
          '404': orderNotFound,
          '409': errorResponse('Transição inválida.', 'INVALID_STATUS_TRANSITION', 'Não é possível mudar de ENTREGUE para PAGO.'),
          ...common,
        },
      },
    },
    '/events': {
      get: {
        tags: ['Eventos'],
        operationId: 'listOrderEvents',
        summary: 'Eventos de pedido (outbox do ms-pedidos)',
        description:
          'Mostra os últimos eventos gravados no outbox e se já foram publicados na fila `order-events`. ' +
          'A especificação AsyncAPI dos eventos fica no ms-pedidos, em `/events/docs`.',
        parameters: [queryParam('limit', 'Quantidade máxima (máx. 100).', { type: 'integer', minimum: 1, maximum: 100, default: 20 })],
        responses: { '200': jsonResponse('Eventos.', ref('OutboxList')), ...common },
      },
    },
    '/health': {
      get: {
        tags: ['Infra'],
        operationId: 'getHealth',
        summary: 'Saúde do BFF e das dependências',
        security: [],
        responses: { '200': jsonResponse('Estado do BFF e de cada serviço de trás.', ref('Health')) },
      },
    },
  };
}

export function buildOpenApiDocument(options: OpenApiOptions = {}): Json {
  const servers: Json[] = [];
  if (options.gatewayUrl) {
    servers.push({ url: options.gatewayUrl, description: 'Pelo API Gateway (caminho oficial, pede a subscription key)' });
  }
  servers.push({
    url: options.publicUrl ?? '/',
    description: options.publicUrl ? 'Direto no BFF' : 'Este servidor',
  });

  return {
    openapi: '3.0.3',
    info: {
      title: 'Conecta Store — BFF',
      version: '1.0.0',
      description:
        'Backend for Frontend do projeto PJBL. É a única API que o microfrontend consome (sempre através do API Gateway).\n\n' +
        '- **Agregação**: `GET /aggregated-data` junta ms-produtos (MongoDB), ms-pedidos (Azure SQL) e a Azure Function.\n' +
        '- **Orquestração**: `POST /orders` consulta o catálogo antes de criar o pedido.\n' +
        '- **Proxy**: CRUD de produtos e pedidos repassado aos microserviços.\n\n' +
        'Toda resposta leva `x-correlation-id`; erros seguem o formato `{ error: { code, message, details, correlationId } }`.',
    },
    servers,
    tags: [
      { name: 'Agregação', description: 'Endpoint que junta todas as fontes' },
      { name: 'Produtos', description: 'Proxy para o ms-produtos (MongoDB)' },
      { name: 'Pedidos', description: 'Orquestração e proxy para o ms-pedidos (Azure SQL)' },
      { name: 'Eventos', description: 'Acompanhamento dos eventos de pedido' },
      { name: 'Infra', description: 'Monitoramento' },
    ],
    security: [{ SubscriptionKey: [] }, { GatewaySecret: [] }],
    paths: buildPaths(),
    components: {
      securitySchemes: {
        SubscriptionKey: {
          type: 'apiKey',
          in: 'header',
          name: 'Ocp-Apim-Subscription-Key',
          description: 'Chave de assinatura do API Gateway (use com o servidor "Pelo API Gateway").',
        },
        GatewaySecret: {
          type: 'apiKey',
          in: 'header',
          name: 'x-gateway-secret',
          description: 'Segredo que o gateway envia ao BFF. Só é necessário para testar direto no BFF quando GATEWAY_SECRET está ligado.',
        },
      },
      schemas: buildSchemas(),
    },
  };
}
