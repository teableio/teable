import { utf8ByteLength } from '@teable/v2-core';

import type { DataQueryManifest } from './DataQueryManifest';
import type { DataQueryDefinitionInput } from './types';

export const dataQueryLintCodes = {
  duplicateDefinition: 'DUPLICATE_DEFINITION',
  queryCount: 'QUERY_COUNT',
  manifestSize: 'MANIFEST_SIZE',
  generatedClientSize: 'GENERATED_CLIENT_SIZE',
  combinatorialManifest: 'COMBINATORIAL_MANIFEST',
  unusedQuery: 'UNUSED_QUERY',
  queryUsageUnknown: 'QUERY_USAGE_UNKNOWN',
} as const;

export type DataQueryLintCode = (typeof dataQueryLintCodes)[keyof typeof dataQueryLintCodes];
/** Warnings fail only under `--strict`; `info` never changes the exit code. */
export type DataQueryLintSeverity = 'warning' | 'info';

export type DataQueryLintFinding = {
  readonly code: DataQueryLintCode;
  readonly severity: DataQueryLintSeverity;
  readonly queryId?: string;
  readonly queryIds?: readonly string[];
  readonly location: string;
  readonly message: string;
};

export type DataQueryLintLimits = {
  /** Warn above this many named queries. */
  readonly maxQueries: number;
  /** Warn when the YAML/JSON manifest exceeds this many bytes. */
  readonly maxManifestBytes: number;
  /** Warn when the generated server module exceeds this many bytes. */
  readonly maxClientBytes: number;
  /** Warn when at least this many literal variants share one query shape. */
  readonly maxCombinatorialVariants: number;
};

export const dataQueryLintDefaultLimits: DataQueryLintLimits = {
  maxQueries: 100,
  maxManifestBytes: 256 * 1024,
  maxClientBytes: 512 * 1024,
  maxCombinatorialVariants: 4,
};

/** Result of scanning App source files for generated-client usage. */
export type DataQueryUsageScan = {
  readonly scannedFiles: number;
  readonly referencedQueryIds: ReadonlyArray<string>;
  /** A computed member access, spread or reflection over `queries` hides static usage. */
  readonly hasDynamicAccess: boolean;
  /** False when some App sources could not be read or traversal stopped early. */
  readonly complete?: boolean;
};

export type DataQueryLintInput = {
  readonly text: string;
  readonly manifest: DataQueryManifest;
  /** Byte length of the generated `lib/queries.ts`; omitted when generation failed. */
  readonly generatedClientBytes?: number;
  readonly generatedClientLocation?: string;
  /** Omitted when the caller cannot read App sources; unused detection is then skipped. */
  readonly usage?: DataQueryUsageScan;
  readonly limits?: Partial<DataQueryLintLimits>;
};

const compare = (left: string, right: string): number => left.localeCompare(right, 'en');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Stable JSON so key order never decides whether two definitions are duplicates. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isPlainObject(value)) return JSON.stringify(value) ?? 'null';
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
};

const hasParameterReference = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasParameterReference);
  if (!isPlainObject(value)) return false;
  if (value.type === 'parameter' && typeof value.name === 'string') return true;
  return Object.values(value).some(hasParameterReference);
};

const definitionShape = (definition: DataQueryDefinitionInput): string =>
  canonicalJson({
    version: definition.version,
    kind: definition.kind,
    tableId: definition.tableId,
    recordId: definition.kind === 'records' ? (definition.recordId ?? null) : undefined,
    relations: definition.version === 2 ? (definition.relations ?? {}) : undefined,
    select: definition.kind === 'records' ? definition.select : undefined,
    aggregates: definition.kind === 'aggregate' ? definition.aggregates : undefined,
    groupBy: definition.kind === 'aggregate' ? (definition.groupBy ?? []) : undefined,
  });

const variantShape = (definition: DataQueryDefinitionInput): string =>
  canonicalJson({
    filter: definition.filter ?? null,
    sort: definition.sort ?? null,
    page: definition.page ?? null,
  });

const definitionLocation = (queryId: string): string => `queries.${queryId}.definition`;

const duplicateFindings = (manifest: DataQueryManifest): DataQueryLintFinding[] => {
  const seen = new Map<string, string[]>();
  for (const queryId of Object.keys(manifest.queries).sort(compare)) {
    const query = manifest.queries[queryId];
    const identity = canonicalJson({
      mode: query.mode ?? (query.definition ? 'structured' : 'sql-query'),
      definition: query.definition ?? null,
      result: query.result ?? 'many',
      fallback: query.fallback ?? null,
    });
    seen.set(identity, [...(seen.get(identity) ?? []), queryId]);
  }
  const findings: DataQueryLintFinding[] = [];
  for (const queryIds of seen.values()) {
    if (queryIds.length < 2) continue;
    findings.push({
      code: dataQueryLintCodes.duplicateDefinition,
      severity: 'warning',
      queryId: queryIds[0],
      queryIds,
      location: `queries.${queryIds[0]}`,
      message: `${queryIds.length} queries have identical byte-normalized definitions (${queryIds.join(
        ', '
      )}). Keep one definition and reuse it.`,
    });
  }
  return findings;
};

const combinatorialFindings = (
  manifest: DataQueryManifest,
  minimumVariants: number
): DataQueryLintFinding[] => {
  const groups = new Map<string, { queryIds: string[]; variants: Set<string> }>();
  for (const queryId of Object.keys(manifest.queries).sort(compare)) {
    const definition = manifest.queries[queryId].definition;
    if (!definition) continue;
    // A parameterized query is not evidence of a literal cross-product, and it must
    // not excuse literal variants that share its shape.
    if (
      hasParameterReference({
        filter: definition.filter,
        sort: definition.sort,
        page: definition.page,
      })
    )
      continue;
    const shape = definitionShape(definition);
    const group = groups.get(shape) ?? { queryIds: [], variants: new Set() };
    group.queryIds.push(queryId);
    group.variants.add(variantShape(definition));
    groups.set(shape, group);
  }
  const findings: DataQueryLintFinding[] = [];
  for (const group of groups.values()) {
    if (group.variants.size < minimumVariants) continue;
    const queryIds = group.queryIds.sort(compare);
    findings.push({
      code: dataQueryLintCodes.combinatorialManifest,
      severity: 'warning',
      queryId: queryIds[0],
      queryIds,
      location: definitionLocation(queryIds[0]),
      message: `${queryIds.length} queries share one table/select/aggregate shape and differ only in literal filter/sort/page combinations (${group.variants.size} variants). Fold the varying values into optional filter leaves, declared parameters or a parameterized sort, or keep only the variants the App actually renders. Do not generate the full cross-product.`,
    });
  }
  return findings;
};

const unusedFindings = (
  manifest: DataQueryManifest,
  usage: DataQueryUsageScan
): DataQueryLintFinding[] => {
  if (usage.hasDynamicAccess) {
    return [
      {
        code: dataQueryLintCodes.queryUsageUnknown,
        severity: 'info',
        location: 'app sources',
        message:
          'App sources access the generated client dynamically, so unused-query detection is inconclusive. No query is reported as unused.',
      },
    ];
  }
  if (usage.complete === false) {
    return [
      {
        code: dataQueryLintCodes.queryUsageUnknown,
        severity: 'info',
        location: 'app sources',
        message:
          'Some App source files could not be read or were skipped by scan limits, so unused-query detection is inconclusive. No query is reported as unused.',
      },
    ];
  }
  if (usage.scannedFiles === 0) {
    return [
      {
        code: dataQueryLintCodes.queryUsageUnknown,
        severity: 'info',
        location: 'app sources',
        message:
          'No App source files were available to scan, so unused-query detection was skipped. Pass --app-root to enable it.',
      },
    ];
  }
  const referenced = new Set(usage.referencedQueryIds);
  return Object.keys(manifest.queries)
    .filter((queryId) => !referenced.has(queryId))
    .sort(compare)
    .map((queryId) => ({
      code: dataQueryLintCodes.unusedQuery,
      severity: 'warning' as const,
      queryId,
      location: `queries.${queryId}`,
      message: `Query \`${queryId}\` has no static reference in the App sources. Remove it or call it from application code; dynamic client access disables this check.`,
    }));
};

/**
 * Authoring-time lint. It never changes backend save/publish behavior and never
 * throws on a warning: callers decide whether `--strict` maps warnings to exit 1.
 */
export function lintDataQueryManifest(input: DataQueryLintInput): DataQueryLintFinding[] {
  const limits: DataQueryLintLimits = { ...dataQueryLintDefaultLimits, ...input.limits };
  const findings: DataQueryLintFinding[] = [];
  const queryIds = Object.keys(input.manifest.queries);
  const manifestBytes = utf8ByteLength(input.text);

  if (queryIds.length > limits.maxQueries) {
    findings.push({
      code: dataQueryLintCodes.queryCount,
      severity: 'warning',
      location: 'queries',
      message: `${queryIds.length} named queries exceed the limit of ${limits.maxQueries}. Split the App or collapse near-duplicate queries; raise --max-queries only with a deliberate reason.`,
    });
  }
  if (manifestBytes > limits.maxManifestBytes) {
    findings.push({
      code: dataQueryLintCodes.manifestSize,
      severity: 'warning',
      location: 'manifest',
      message: `Manifest is ${manifestBytes} bytes, over the limit of ${limits.maxManifestBytes}. Reduce duplicated definitions before the generated client grows further.`,
    });
  }
  if (
    input.generatedClientBytes !== undefined &&
    input.generatedClientBytes > limits.maxClientBytes
  ) {
    findings.push({
      code: dataQueryLintCodes.generatedClientSize,
      severity: 'warning',
      location: input.generatedClientLocation ?? 'lib/queries.ts',
      message: `Generated client is ${input.generatedClientBytes} bytes, over the limit of ${limits.maxClientBytes}. Reduce query count or aliases; raise --max-client-bytes only with a deliberate reason.`,
    });
  }
  findings.push(...duplicateFindings(input.manifest));
  findings.push(...combinatorialFindings(input.manifest, limits.maxCombinatorialVariants));
  if (input.usage) findings.push(...unusedFindings(input.manifest, input.usage));

  return findings.sort(
    (left, right) =>
      compare(left.code, right.code) ||
      compare(left.location, right.location) ||
      compare(left.message, right.message)
  );
}

const dottedUsage = /\bqueries\s*\??\.\s*([A-Za-z_$][\w$]*)/g;
const bracketUsage = /\bqueries\s*(?:\?\.\s*)?\[([^\]]*)\]/g;
const destructuringUsage = /\{([^{}]*)\}\s*=\s*queries\b/g;
const reflectedUsage =
  /\bObject\s*\.\s*(?:keys|values|entries|assign|getOwnPropertyNames)\s*\(\s*queries\s*\)/;
const spreadUsage = /\.\.\.\s*queries\b/;
const iterationUsage =
  /for\s*\([^)]*\b(?:in|of)\s+queries\b|\b(?:Array\.from|Object\.fromEntries)\s*\(\s*queries\b/;
const aliasUsage = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*queries\b/;
// A renamed import hides the binding name the scanner looks for.
const importAliasUsage = /\bimport\s*\{[^}]*\bqueries\s+as\s+[A-Za-z_$][^}]*\}/;

const destructuredQueryIds = (pattern: string): ReadonlyArray<string> | undefined => {
  const ids: string[] = [];
  for (const part of pattern.split(',')) {
    const property = part.trim();
    if (!property) continue;
    // A rest element or computed key hides which query names are read.
    if (property.startsWith('...') || property.startsWith('[')) return undefined;
    const sourceName = property.split(/[:=]/, 1)[0].trim();
    if (!/^[A-Z_$][\w$]*$/i.test(sourceName)) return undefined;
    ids.push(sourceName);
  }
  return ids;
};
/** Add static bracket keys; any expression key makes usage inconclusive. */
const collectBracketUsage = (text: string, referenced: Set<string>): boolean => {
  let dynamic = false;
  for (const match of text.matchAll(bracketUsage)) {
    const literal = /^(['"`])([A-Z_$][\w$]*)\1$/i.exec(match[1].trim());
    if (literal) referenced.add(literal[2]);
    else dynamic = true;
  }
  return dynamic;
};

/** Add destructured keys; rest or computed patterns make usage inconclusive. */
const collectDestructuredUsage = (text: string, referenced: Set<string>): boolean => {
  let dynamic = false;
  for (const match of text.matchAll(destructuringUsage)) {
    const ids = destructuredQueryIds(match[1]);
    if (ids) ids.forEach((id) => referenced.add(id));
    else dynamic = true;
  }
  return dynamic;
};

/**
 * Conservative usage scan over App source text. Any computed access makes the
 * result inconclusive instead of claiming a query is unused.
 */
export function scanDataQueryUsage(
  sources: ReadonlyArray<{ path: string; text: string }>
): DataQueryUsageScan {
  const referenced = new Set<string>();
  let hasDynamicAccess = false;
  for (const source of sources) {
    for (const match of source.text.matchAll(dottedUsage)) referenced.add(match[1]);
    if (collectBracketUsage(source.text, referenced)) hasDynamicAccess = true;
    if (collectDestructuredUsage(source.text, referenced)) hasDynamicAccess = true;
    if (
      reflectedUsage.test(source.text) ||
      spreadUsage.test(source.text) ||
      aliasUsage.test(source.text) ||
      importAliasUsage.test(source.text) ||
      iterationUsage.test(source.text)
    )
      hasDynamicAccess = true;
  }
  return {
    scannedFiles: sources.length,
    referencedQueryIds: [...referenced].sort(compare),
    hasDynamicAccess,
  };
}
