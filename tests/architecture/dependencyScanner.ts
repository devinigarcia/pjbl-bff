import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';

// Scanner caseiro de dependências: lê os .ts de src/, extrai os imports por regex e
// classifica cada arquivo por camada e por feature. As regras de arquitetura (rules.ts)
// trabalham em cima dessa lista — sem biblioteca externa, de propósito, para a gente
// entender exatamente o que está sendo verificado.

export type Layer = 'domain' | 'application' | 'infrastructure' | 'api' | 'root';

export interface ImportRef {
  specifier: string;
  /** import relativo já resolvido para um caminho dentro de src (ex.: "domain/errors") */
  target: string | null;
  layer: Layer | null;
  feature: string | null;
  /** nome do pacote quando não é import relativo (ex.: "zod", "node:crypto", "@azure/functions") */
  packageName: string | null;
}

export interface SourceFile {
  /** caminho relativo a src, com barras normais (ex.: "application/features/PlaceOrder/PlaceOrder.ts") */
  path: string;
  layer: Layer;
  feature: string | null;
  content: string;
  imports: ImportRef[];
}

const LAYERS: Layer[] = ['domain', 'application', 'infrastructure', 'api'];

export function layerOf(path: string): Layer {
  const first = path.split('/')[0] as Layer;
  return LAYERS.includes(first) ? first : 'root';
}

export function featureOf(path: string): string | null {
  const match = /(?:^|\/)features\/([^/]+)\//.exec(path);
  return match?.[1] ?? null;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of stripComments(source).matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function packageNameOf(specifier: string): string {
  if (specifier.startsWith('node:')) return specifier;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] as string);
}

/** Monta um SourceFile a partir do caminho e do conteúdo (também usado para plantar violações nos testes). */
export function analyze(path: string, content: string): SourceFile {
  const imports = extractSpecifiers(content).map((specifier): ImportRef => {
    if (!specifier.startsWith('.')) {
      return { specifier, target: null, layer: null, feature: null, packageName: packageNameOf(specifier) };
    }
    const target = posix.normalize(posix.join(posix.dirname(path), specifier));
    return { specifier, target, layer: layerOf(target), feature: featureOf(`${target}/`), packageName: null };
  });

  return { path, layer: layerOf(path), feature: featureOf(path), content, imports };
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
  });
}

export const SRC_DIR = join(dirname(__dirname), '..', 'src');

/** Lê todos os arquivos TypeScript de src/. */
export function scanSources(srcDir: string = SRC_DIR): SourceFile[] {
  return walk(srcDir).map((full) => {
    const path = relative(srcDir, full).split(sep).join('/');
    return analyze(path, readFileSync(full, 'utf8'));
  });
}
