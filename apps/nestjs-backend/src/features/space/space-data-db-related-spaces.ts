import { FieldType } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import type { IDataDbConnectionSummaryVo } from '@teable/openapi';
import { extractForeignTableId } from '../base/cross-space-detection.util';
import { fingerprintDatabaseUrl } from './data-db-preflight.service';
import { decryptDataDbUrl } from './data-db-url-secret';

export type ISpaceDataDbRelatedSpaces = NonNullable<IDataDbConnectionSummaryVo['relatedSpaces']>;
export type ISpaceDataDbRelatedSpaceInfo = ISpaceDataDbRelatedSpaces['spaces'][number];
export type ISpaceDataDbRelatedSpaceLink = ISpaceDataDbRelatedSpaces['links'][number];

type ICandidateFieldRow = {
  id: string;
  type: string;
  isLookup: boolean | null;
  isConditionalLookup: boolean | null;
  options: string | null;
  lookupOptions: string | null;
  tableId: string;
  spaceId: string;
};

type IComponentGraph = {
  relatedSpaceIds: Set<string>;
  links: ISpaceDataDbRelatedSpaceLink[];
};

const dataDbMode = (mode: string | null | undefined): 'default' | 'byodb' =>
  mode === 'byodb' ? 'byodb' : 'default';

const dataDbBindingState = (
  state: string | null | undefined
): ISpaceDataDbRelatedSpaceInfo['dataDbState'] => {
  if (
    state === 'ready' ||
    state === 'validating' ||
    state === 'initializing' ||
    state === 'migrating' ||
    state === 'error' ||
    state === 'disabled'
  ) {
    return state;
  }
  return undefined;
};

const relatedFieldTypeConditions = [
  {
    type: FieldType.Link,
    OR: [{ isLookup: false }, { isLookup: null }],
  },
  { type: FieldType.ConditionalRollup },
  { isLookup: true, isConditionalLookup: true },
];

const findFrontierTables = async (prismaService: PrismaService, spaceIds: string[]) =>
  await prismaService.tableMeta.findMany({
    where: {
      deletedTime: null,
      base: {
        deletedTime: null,
        spaceId: { in: spaceIds },
        space: {
          deletedTime: null,
        },
      },
    },
    select: {
      id: true,
      base: {
        select: {
          spaceId: true,
        },
      },
    },
  });

const findLinkFieldsOfSpaces = async (
  prismaService: PrismaService,
  spaceIds: string[]
): Promise<ICandidateFieldRow[]> => {
  const fields = await prismaService.field.findMany({
    where: {
      deletedTime: null,
      table: {
        deletedTime: null,
        base: {
          deletedTime: null,
          spaceId: { in: spaceIds },
          space: {
            deletedTime: null,
          },
        },
      },
      OR: relatedFieldTypeConditions,
    },
    select: {
      id: true,
      type: true,
      isLookup: true,
      isConditionalLookup: true,
      options: true,
      lookupOptions: true,
      tableId: true,
      table: {
        select: {
          base: {
            select: {
              spaceId: true,
            },
          },
        },
      },
    },
  });
  return fields.map((field) => ({
    id: field.id,
    type: field.type,
    isLookup: field.isLookup,
    isConditionalLookup: field.isConditionalLookup,
    options: field.options,
    lookupOptions: field.lookupOptions,
    tableId: field.tableId,
    spaceId: field.table.base.spaceId,
  }));
};

// Coarse SQL prefilter for inbound links: match EVERY `"foreignTableId":"..."`
// occurrence in the JSON blob (regexp_matches with 'g') so the scan returns only
// candidate rows instead of every link-ish field in the instance. Matching all
// occurrences keeps the prefilter a superset of the truth: a nested occurrence can
// only add a false positive, never hide a row whose real top-level target is in the
// frontier. `extractForeignTableId` (real JSON parsing) stays the source of truth
// for every returned row, so a regex false positive can never fabricate an edge.
const findLinkFieldsReferencingTables = async (
  prismaService: PrismaService,
  tableIds: string[]
): Promise<ICandidateFieldRow[]> => {
  if (!tableIds.length) {
    return [];
  }
  return await prismaService.$queryRawUnsafe<ICandidateFieldRow[]>(
    `SELECT f.id,
            f.type,
            f.is_lookup AS "isLookup",
            f.is_conditional_lookup AS "isConditionalLookup",
            f.options,
            f.lookup_options AS "lookupOptions",
            f.table_id AS "tableId",
            b.space_id AS "spaceId"
     FROM field f
     JOIN table_meta t ON t.id = f.table_id AND t.deleted_time IS NULL
     JOIN base b ON b.id = t.base_id AND b.deleted_time IS NULL
     JOIN space s ON s.id = b.space_id AND s.deleted_time IS NULL
     WHERE f.deleted_time IS NULL
       AND ((f.type = $1 AND f.is_lookup IS NOT TRUE)
         OR f.type = $2
         OR (f.is_lookup IS TRUE AND f.is_conditional_lookup IS TRUE))
       AND EXISTS (
         SELECT 1
         FROM regexp_matches(
           CASE WHEN f.is_lookup IS TRUE AND f.is_conditional_lookup IS TRUE
                THEN f.lookup_options
                ELSE f.options END,
           '"foreignTableId"\\s*:\\s*"([^"]+)"',
           'g'
         ) AS matches(captured)
         WHERE matches.captured[1] = ANY($3::text[])
       )`,
    FieldType.Link,
    FieldType.ConditionalRollup,
    tableIds
  );
};

const collectFrontierCandidates = async (
  prismaService: PrismaService,
  frontier: string[],
  spaceIdByTableId: Map<string, string>
): Promise<Map<string, ICandidateFieldRow>> => {
  const frontierTables = await findFrontierTables(prismaService, frontier);
  for (const table of frontierTables) {
    spaceIdByTableId.set(table.id, table.base.spaceId);
  }

  const [outbound, inbound] = await Promise.all([
    findLinkFieldsOfSpaces(prismaService, frontier),
    findLinkFieldsReferencingTables(
      prismaService,
      frontierTables.map((table) => table.id)
    ),
  ]);
  const candidates = new Map<string, ICandidateFieldRow>();
  for (const field of [...outbound, ...inbound]) {
    if (!candidates.has(field.id)) {
      candidates.set(field.id, field);
    }
  }
  return candidates;
};

const resolveForeignSpaceIds = async (
  prismaService: PrismaService,
  candidates: Iterable<ICandidateFieldRow>,
  spaceIdByTableId: Map<string, string>
) => {
  const unknownForeignTableIds = new Set<string>();
  for (const field of candidates) {
    const foreignTableId = extractForeignTableId(field);
    if (foreignTableId && !spaceIdByTableId.has(foreignTableId)) {
      unknownForeignTableIds.add(foreignTableId);
    }
  }
  if (!unknownForeignTableIds.size) {
    return;
  }
  const foreignTables = await prismaService.tableMeta.findMany({
    where: {
      id: { in: [...unknownForeignTableIds] },
      deletedTime: null,
      base: {
        deletedTime: null,
        space: {
          deletedTime: null,
        },
      },
    },
    select: {
      id: true,
      base: {
        select: {
          spaceId: true,
        },
      },
    },
  });
  for (const table of foreignTables) {
    spaceIdByTableId.set(table.id, table.base.spaceId);
  }
};

const applyCandidateEdge = (
  field: ICandidateFieldRow,
  input: {
    spaceIdByTableId: Map<string, string>;
    graph: IComponentGraph;
    linkedFieldIds: Set<string>;
    nextFrontier: Set<string>;
  }
) => {
  const { spaceIdByTableId, graph, linkedFieldIds, nextFrontier } = input;
  const foreignTableId = extractForeignTableId(field);
  if (!foreignTableId) return;
  const fromSpaceId = field.spaceId;
  const toSpaceId = spaceIdByTableId.get(foreignTableId);
  if (!toSpaceId || fromSpaceId === toSpaceId) return;
  // Prefilter false positives (e.g. a nested foreignTableId occurrence) may surface
  // edges between two unrelated spaces; only edges touching the component count.
  if (!graph.relatedSpaceIds.has(fromSpaceId) && !graph.relatedSpaceIds.has(toSpaceId)) return;
  if (!linkedFieldIds.has(field.id)) {
    linkedFieldIds.add(field.id);
    graph.links.push({
      fromSpaceId,
      fromTableId: field.tableId,
      fromFieldId: field.id,
      toSpaceId,
      toTableId: foreignTableId,
    });
  }
  for (const spaceId of [fromSpaceId, toSpaceId]) {
    if (!graph.relatedSpaceIds.has(spaceId)) {
      graph.relatedSpaceIds.add(spaceId);
      nextFrontier.add(spaceId);
    }
  }
};

const applyCandidateEdges = (input: {
  candidates: Iterable<ICandidateFieldRow>;
  spaceIdByTableId: Map<string, string>;
  graph: IComponentGraph;
  linkedFieldIds: Set<string>;
}): string[] => {
  const { candidates, ...context } = input;
  const nextFrontier = new Set<string>();
  for (const field of candidates) {
    applyCandidateEdge(field, { ...context, nextFrontier });
  }
  return [...nextFrontier];
};

// Grow the connected component space by space instead of loading every link-ish
// field in the instance and building the full global space graph.
const collectComponentGraph = async (
  prismaService: PrismaService,
  primarySpaceId: string
): Promise<IComponentGraph> => {
  const graph: IComponentGraph = {
    relatedSpaceIds: new Set<string>([primarySpaceId]),
    links: [],
  };
  const spaceIdByTableId = new Map<string, string>();
  const linkedFieldIds = new Set<string>();

  let frontier = [primarySpaceId];
  while (frontier.length) {
    const candidates = await collectFrontierCandidates(prismaService, frontier, spaceIdByTableId);
    await resolveForeignSpaceIds(prismaService, candidates.values(), spaceIdByTableId);
    frontier = applyCandidateEdges({
      candidates: candidates.values(),
      spaceIdByTableId,
      graph,
      linkedFieldIds,
    });
  }
  return graph;
};

export const resolveSpaceDataDbRelatedSpaces = async (
  prismaService: PrismaService,
  primarySpaceId: string
): Promise<ISpaceDataDbRelatedSpaces> => {
  const { relatedSpaceIds, links } = await collectComponentGraph(prismaService, primarySpaceId);

  const [spaces, bindings] = await Promise.all([
    prismaService.space.findMany({
      where: { id: { in: [...relatedSpaceIds] }, deletedTime: null },
      select: {
        id: true,
        name: true,
        baseGroup: {
          where: { deletedTime: null },
          select: {
            id: true,
            tables: {
              where: { deletedTime: null },
              select: { id: true },
            },
          },
        },
      },
    }),
    prismaService.spaceDataDbBinding.findMany({
      where: { spaceId: { in: [...relatedSpaceIds] } },
      include: { dataDbConnection: true },
    }),
  ]);

  const bindingBySpaceId = new Map(bindings.map((binding) => [binding.spaceId, binding]));
  const relatedSpaces = spaces
    .map<ISpaceDataDbRelatedSpaceInfo>((space) => {
      const binding = bindingBySpaceId.get(space.id);
      const connection = binding?.dataDbConnection;
      return {
        spaceId: space.id,
        name: space.name,
        isPrimary: space.id === primarySpaceId,
        baseIds: space.baseGroup.map((base) => base.id).sort(),
        tableIds: space.baseGroup.flatMap((base) => base.tables.map((table) => table.id)).sort(),
        dataDbMode: dataDbMode(binding?.mode),
        dataDbState: dataDbBindingState(binding?.state),
        dataDbConnectionId: connection?.id ?? null,
        dataDbUrlFingerprint: connection?.urlFingerprint ?? null,
        dataDbDatabaseFingerprint: connection?.encryptedUrl
          ? fingerprintDatabaseUrl(decryptDataDbUrl(connection.encryptedUrl))
          : null,
        dataDbDisplayHost: connection?.displayHost ?? null,
        dataDbDisplayDatabase: connection?.displayDatabase ?? null,
        dataDbInternalSchema: connection?.internalSchema ?? null,
      };
    })
    .sort((left, right) =>
      left.isPrimary === right.isPrimary
        ? left.name.localeCompare(right.name) || left.spaceId.localeCompare(right.spaceId)
        : left.isPrimary
          ? -1
          : 1
    );

  const componentIds = new Set(relatedSpaces.map((space) => space.spaceId));
  return {
    primarySpaceId,
    hasCrossSpaceLinks: relatedSpaces.length > 1,
    spaces: relatedSpaces,
    links: links
      .filter((link) => componentIds.has(link.fromSpaceId) && componentIds.has(link.toSpaceId))
      .sort(
        (left, right) =>
          left.fromSpaceId.localeCompare(right.fromSpaceId) ||
          left.toSpaceId.localeCompare(right.toSpaceId) ||
          left.fromFieldId.localeCompare(right.fromFieldId)
      ),
  };
};
