/** Dados da requisição original que precisam acompanhar as chamadas aos serviços de trás. */
export interface CallContext {
  correlationId: string;
}
