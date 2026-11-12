import type { SourceFile } from './dependencyScanner';

// Cada regra recebe a lista de arquivos e devolve as violações encontradas (lista vazia = tudo certo).
// Ficam separadas do arquivo de teste para a gente também conseguir testar as próprias regras
// com arquivos "de mentira" contendo uma violação plantada.

export type Rule = (files: SourceFile[]) => string[];

const describeImport = (file: SourceFile, specifier: string) => `${file.path} importa "${specifier}"`;

/** Domain é TypeScript puro: não depende de outra camada nem de pacote nenhum (nem node:). */
export const domainIsPure: Rule = (files) =>
  files
    .filter((file) => file.layer === 'domain')
    .flatMap((file) =>
      file.imports
        .filter((imported) => imported.packageName !== null || imported.layer !== 'domain')
        .map((imported) => describeImport(file, imported.specifier)),
    );

const APPLICATION_ALLOWED_PACKAGES = new Set(['zod', 'node:crypto']);

/** Application só enxerga o Domain (e ela mesma). De pacotes, só zod e node:crypto. */
export const applicationDependsOnlyOnDomain: Rule = (files) =>
  files
    .filter((file) => file.layer === 'application')
    .flatMap((file) =>
      file.imports
        .filter((imported) =>
          imported.packageName !== null
            ? !APPLICATION_ALLOWED_PACKAGES.has(imported.packageName)
            : imported.layer !== 'domain' && imported.layer !== 'application',
        )
        .map((imported) => describeImport(file, imported.specifier)),
    );

/** Infrastructure implementa as portas da Application, mas não conhece a API. */
export const infrastructureDoesNotDependOnApi: Rule = (files) =>
  files
    .filter((file) => file.layer === 'infrastructure')
    .flatMap((file) =>
      file.imports
        .filter((imported) => imported.layer === 'api' || imported.layer === 'root')
        .map((imported) => describeImport(file, imported.specifier)),
    );

/** A API não importa a Infrastructure: quem liga as duas é só o main.ts. */
export const apiDoesNotDependOnInfrastructure: Rule = (files) =>
  files
    .filter((file) => file.layer === 'api')
    .flatMap((file) =>
      file.imports
        .filter((imported) => imported.layer === 'infrastructure' || imported.layer === 'root')
        .map((imported) => describeImport(file, imported.specifier)),
    );

/** Fora das quatro camadas só pode existir o main.ts (composition root). */
export const onlyMainIsOutsideLayers: Rule = (files) =>
  files.filter((file) => file.layer === 'root' && file.path !== 'main.ts').map((file) => `${file.path} está fora das camadas`);

const WEB_PACKAGES = new Set(['express', 'cors', 'helmet', 'express-rate-limit', 'swagger-ui-express', 'pino-http']);

/** Framework web (Express e companhia) só aparece na camada API. */
export const webFrameworkOnlyInApi: Rule = (files) =>
  files
    .filter((file) => file.layer !== 'api')
    .flatMap((file) =>
      file.imports
        .filter((imported) => imported.packageName !== null && WEB_PACKAGES.has(imported.packageName))
        .map((imported) => describeImport(file, imported.specifier)),
    );

/** Chamada HTTP para fora (fetch) só na Infrastructure — é ela que fala com os microserviços. */
export const outboundHttpOnlyInInfrastructure: Rule = (files) =>
  files
    .filter((file) => file.layer !== 'infrastructure' && /\bfetch\s*\(/.test(file.content))
    .map((file) => `${file.path} usa fetch() fora da infrastructure`);

/** Vertical slice: uma feature não importa código de outra feature. */
export const featuresAreIsolated: Rule = (files) =>
  files
    .filter((file) => file.feature !== null)
    .flatMap((file) =>
      file.imports
        .filter((imported) => imported.feature !== null && imported.feature !== file.feature)
        .map((imported) => `${describeImport(file, imported.specifier)} (feature ${file.feature} → ${imported.feature})`),
    );

const applicationFeatures = (files: SourceFile[]) =>
  [...new Set(files.filter((file) => file.layer === 'application' && file.feature).map((file) => file.feature as string))].sort();

/** Toda feature da Application tem o arquivo <Feature>.ts exportando a classe <Feature>Handler. */
export const everyFeatureHasHandler: Rule = (files) =>
  applicationFeatures(files).flatMap((feature) => {
    const file = files.find((candidate) => candidate.path === `application/features/${feature}/${feature}.ts`);
    if (!file) return [`falta application/features/${feature}/${feature}.ts`];
    return new RegExp(`export\\s+class\\s+${feature}Handler\\b`).test(file.content)
      ? []
      : [`${file.path} não exporta a classe ${feature}Handler`];
  });

/** Toda feature da Application tem o adaptador HTTP correspondente em api/features/<Feature>/<Feature>Endpoint.ts. */
export const everyFeatureHasEndpoint: Rule = (files) =>
  applicationFeatures(files)
    .filter((feature) => !files.some((file) => file.path === `api/features/${feature}/${feature}Endpoint.ts`))
    .map((feature) => `falta api/features/${feature}/${feature}Endpoint.ts`);

/** O endpoint de uma feature não inventa feature nova: toda pasta em api/features existe na application. */
export const noOrphanEndpoints: Rule = (files) => {
  const known = new Set(applicationFeatures(files));
  return [...new Set(files.filter((file) => file.layer === 'api' && file.feature).map((file) => file.feature as string))]
    .filter((feature) => !known.has(feature))
    .map((feature) => `api/features/${feature} não tem feature correspondente na application`);
};

export const featureNames = applicationFeatures;
