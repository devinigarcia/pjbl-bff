import { describe, expect, it } from 'vitest';
import { analyze, extractSpecifiers, scanSources } from './dependencyScanner';
import {
  apiDoesNotDependOnInfrastructure,
  applicationDependsOnlyOnDomain,
  domainIsPure,
  everyFeatureHasEndpoint,
  everyFeatureHasHandler,
  featureNames,
  featuresAreIsolated,
  infrastructureDoesNotDependOnApi,
  noOrphanEndpoints,
  onlyMainIsOutsideLayers,
  outboundHttpOnlyInInfrastructure,
  webFrameworkOnlyInApi,
} from './rules';

// Testes de arquitetura: garantem que a Clean Architecture e os Vertical Slices
// continuam valendo conforme o código cresce. Se alguém importar o que não deve, quebra aqui.

const files = scanSources();

describe('Clean Architecture — direção das dependências', () => {
  it('o scanner encontrou arquivos nas quatro camadas', () => {
    const layers = new Set(files.map((file) => file.layer));

    expect(layers).toEqual(new Set(['domain', 'application', 'infrastructure', 'api', 'root']));
    expect(files.length).toBeGreaterThan(20);
  });

  it('Domain não depende de nenhuma outra camada nem de pacotes externos', () => {
    expect(domainIsPure(files)).toEqual([]);
  });

  it('Application depende só do Domain e não usa framework (apenas zod)', () => {
    expect(applicationDependsOnlyOnDomain(files)).toEqual([]);
  });

  it('Infrastructure não depende da API', () => {
    expect(infrastructureDoesNotDependOnApi(files)).toEqual([]);
  });

  it('API não importa a Infrastructure (a ligação é feita só no main.ts)', () => {
    expect(apiDoesNotDependOnInfrastructure(files)).toEqual([]);
  });

  it('só o main.ts fica fora das camadas', () => {
    expect(onlyMainIsOutsideLayers(files)).toEqual([]);
  });

  it('Express e demais pacotes web só aparecem na camada API', () => {
    expect(webFrameworkOnlyInApi(files)).toEqual([]);
  });

  it('chamadas HTTP para os microserviços (fetch) só existem na Infrastructure', () => {
    expect(outboundHttpOnlyInInfrastructure(files)).toEqual([]);
  });
});

describe('Vertical Slice — organização por feature', () => {
  it('as features esperadas existem', () => {
    expect(featureNames(files)).toEqual(['CheckHealth', 'GetAggregatedData', 'OrdersProxy', 'PlaceOrder', 'ProductsProxy']);
  });

  it('uma feature não importa código de outra feature', () => {
    expect(featuresAreIsolated(files)).toEqual([]);
  });

  it('toda feature tem <Feature>.ts exportando a classe <Feature>Handler', () => {
    expect(everyFeatureHasHandler(files)).toEqual([]);
  });

  it('toda feature tem o seu <Feature>Endpoint.ts na API', () => {
    expect(everyFeatureHasEndpoint(files)).toEqual([]);
  });

  it('não existe endpoint sem feature correspondente na Application', () => {
    expect(noOrphanEndpoints(files)).toEqual([]);
  });
});

// As regras acima só valem alguma coisa se realmente pegarem um erro.
// Aqui plantamos violações em arquivos "de mentira" e conferimos que cada regra reclama.
describe('as regras detectam violações plantadas', () => {
  const withViolation = (path: string, content: string) => [...files, analyze(path, content)];

  it('pega o Domain importando um pacote ou outra camada', () => {
    expect(domainIsPure(withViolation('domain/bad.ts', "import express from 'express';"))).toHaveLength(1);
    expect(domainIsPure(withViolation('domain/bad.ts', "import { x } from '../infrastructure/config';"))).toHaveLength(1);
    expect(domainIsPure(withViolation('domain/bad.ts', "import { randomUUID } from 'node:crypto';"))).toHaveLength(1);
  });

  it('pega a Application importando Infrastructure, API ou um framework', () => {
    const feature = 'application/features/PlaceOrder/bad.ts';

    expect(applicationDependsOnlyOnDomain(withViolation(feature, "import { x } from '../../../infrastructure/config';"))).toHaveLength(1);
    expect(applicationDependsOnlyOnDomain(withViolation(feature, "import { y } from '../../../api/http';"))).toHaveLength(1);
    expect(applicationDependsOnlyOnDomain(withViolation(feature, "import pino from 'pino';"))).toHaveLength(1);
  });

  it('pega a API importando a Infrastructure e a Infrastructure importando a API', () => {
    expect(
      apiDoesNotDependOnInfrastructure(withViolation('api/bad.ts', "import { loadConfig } from '../infrastructure/config';")),
    ).toHaveLength(1);
    expect(
      infrastructureDoesNotDependOnApi(withViolation('infrastructure/bad.ts', "import { createApp } from '../api/app';")),
    ).toHaveLength(1);
  });

  it('pega uma feature importando outra', () => {
    const violations = featuresAreIsolated(
      withViolation(
        'application/features/PlaceOrder/bad.ts',
        "import { ProductsProxyHandler } from '../ProductsProxy/ProductsProxy';",
      ),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('PlaceOrder → ProductsProxy');
  });

  it('pega fetch fora da Infrastructure e Express fora da API', () => {
    expect(
      outboundHttpOnlyInInfrastructure(withViolation('application/features/PlaceOrder/bad.ts', "await fetch('http://ms-produtos');")),
    ).toHaveLength(1);
    expect(webFrameworkOnlyInApi(withViolation('infrastructure/bad.ts', "import express from 'express';"))).toHaveLength(1);
  });

  it('pega feature sem Handler, sem Endpoint e arquivo solto fora das camadas', () => {
    const semHandler = withViolation('application/features/Nova/Nova.ts', 'export class OutroNome {}');

    expect(everyFeatureHasHandler(semHandler)).toEqual(['application/features/Nova/Nova.ts não exporta a classe NovaHandler']);
    expect(everyFeatureHasEndpoint(semHandler)).toEqual(['falta api/features/Nova/NovaEndpoint.ts']);
    expect(onlyMainIsOutsideLayers(withViolation('utils.ts', ''))).toEqual(['utils.ts está fora das camadas']);
  });
});

describe('scanner de imports', () => {
  it('entende import normal, import type, multilinha, export from, require e import dinâmico', () => {
    const source = `
      import a from 'pacote-a';
      import type { B } from './b';
      import {
        c,
        d,
      } from "../c";
      export { e } from './e';
      import 'efeito-colateral';
      const f = require('pacote-f');
      const g = await import('./g');
      // import fantasma from 'comentado';
      /* import outro from 'tambem-comentado'; */
    `;

    expect(extractSpecifiers(source)).toEqual(['pacote-a', './b', '../c', './e', 'efeito-colateral', 'pacote-f', './g']);
  });

  it('classifica camada, feature e pacote com escopo', () => {
    const file = analyze(
      'api/features/PlaceOrder/PlaceOrderEndpoint.ts',
      "import x from '../../../application/features/PlaceOrder/PlaceOrder'; import y from '@azure/functions/sub';",
    );

    expect(file.layer).toBe('api');
    expect(file.feature).toBe('PlaceOrder');
    expect(file.imports[0]).toMatchObject({ layer: 'application', feature: 'PlaceOrder', packageName: null });
    expect(file.imports[1]).toMatchObject({ packageName: '@azure/functions', layer: null });
  });
});
