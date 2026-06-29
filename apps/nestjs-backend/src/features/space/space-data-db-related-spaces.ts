import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IDataDbConnectionSummaryVo } from '@teable/openapi';
import { extractForeignTableId } from '../base/cross-space-detection.util';
import { decryptDataDbUrl } from './data-db-url-secret';
import { fingerprintDatabaseUrl } from './data-db-preflight.service';

export type ISpaceDataDbRelatedSpaces = NonNullable<IDataDbConnectionSummaryVo['relatedSpaces']>;
export type ISpaceDataDbRelatedSpaceInfo = ISpaceDataDbRelatedSpaces['spaces'][number];
export type ISpaceDataDbRelatedSpaceLink = ISpaceDataDbRelatedSpaces['links'][number];

type IRelatedFieldRow = {
  id: string;
  type: string;
  isLookup: boolean | null;
  isConditionalLookup: boolean | null;
  options: string | null;
  lookupOptions: string | null;
  tableId: string;
  table: {
    id: string;
    base: {
      spaceId: string;
    };
  };
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

export const resolveSpaceDataDbRelatedSpaces = async (
  prismaService: PrismaService,
  primarySpaceId: string
): Promise<ISpaceDataDbRelatedSpaces> => {
  const fields = (await prismaService.field.findMany({
    where: {
      deletedTime: null,
      table: {
        deletedTime: null,
        base: {
          deletedTime: null,
          space: {
            deletedTime: null,
          },
        },
      },
      OR: [
        {
          type: FieldType.Link,
          OR: [{ isLookup: false }, { isLookup: null }],
        },
        { type: FieldType.ConditionalRollup },
        { isLookup: true, isConditionalLookup: true },
      ],
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
          id: true,
          base: {
            select: {
              spaceId: true,
            },
          },
        },
      },
    },
  })) as IRelatedFieldRow[];

  const foreignTableIds = Array.from(
    new Set(fields.map((field) => extractForeignTableId(field)).filter((id): id is string => !!id))
  );
  const foreignTables = foreignTableIds.length
    ? await prismaService.tableMeta.findMany({
        where: {
          id: { in: foreignTableIds },
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
      })
    : [];
  const foreignSpaceByTableId = new Map(
    foreignTables.map((table) => [table.id, table.base.spaceId])
  );

  const links: ISpaceDataDbRelatedSpaceLink[] = [];
  const adjacency = new Map<string, Set<string>>();
  const connect = (left: string, right: string) => {
    if (left === right) return;
    const leftSet = adjacency.get(left) ?? new Set<string>();
    leftSet.add(right);
    adjacency.set(left, leftSet);
    const rightSet = adjacency.get(right) ?? new Set<string>();
    rightSet.add(left);
    adjacency.set(right, rightSet);
  };

  for (const field of fields) {
    const foreignTableId = extractForeignTableId(field);
    if (!foreignTableId) continue;
    const fromSpaceId = field.table.base.spaceId;
    const toSpaceId = foreignSpaceByTableId.get(foreignTableId);
    if (!toSpaceId || fromSpaceId === toSpaceId) continue;
    connect(fromSpaceId, toSpaceId);
    links.push({
      fromSpaceId,
      fromTableId: field.tableId,
      fromFieldId: field.id,
      toSpaceId,
      toTableId: foreignTableId,
    });
  }

  const relatedSpaceIds = new Set<string>([primarySpaceId]);
  const queue = [primarySpaceId];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const next of adjacency.get(current) ?? []) {
      if (relatedSpaceIds.has(next)) continue;
      relatedSpaceIds.add(next);
      queue.push(next);
    }
  }

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
