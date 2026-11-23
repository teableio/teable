import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { createAccessToken, deleteAccessToken } from '@teable/openapi';
import type { CreateAccessTokenRo, CreateAccessTokenVo } from '@teable/openapi';
import { DuplicateBaseHandler, ok } from '@teable/v2-core';
import type { DuplicateBaseEvent } from '@teable/v2-core';
import { vi } from 'vitest';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { BaseModule } from '../src/features/base/base.module';
import {
  createBase, createSpace, createTable, initApp, permanentDeleteSpace,
} from './utils/init-app';
import { requestPublicOrpc } from './utils/public-orpc';

describe('public oRPC base duplication allocation and compensation', () => {
  let app: INestApplication;
  let appUrl: string;
  let prisma: PrismaService;
  let sourceBaseId: string;
  let spaceId: string;
  let sourceOnly: CreateAccessTokenVo;
  let duplicateToken: CreateAccessTokenVo;
  const tokenIds: string[] = [];
  const scopes: CreateAccessTokenRo['scopes'] = [
    'base|read', 'base|create', 'table|read', 'table|create', 'field|read', 'field|create',
    'view|read', 'view|create', 'record|read', 'record|create',
  ];
  const duplicate = (name: string, token = duplicateToken.token) => requestPublicOrpc(appUrl,
    '/bases/duplicate', { sourceBaseId, name, withRecords: true },
    { headers: { authorization: `Bearer ${token}` } });
  const state = async () => ({
    bases: await prisma.base.findMany({ where: { spaceId }, select: { id: true }, orderBy: { id: 'asc' } }),
    tables: await prisma.tableMeta.findMany({ where: { base: { spaceId } }, select: { id: true, baseId: true }, orderBy: { id: 'asc' } }),
    schemas: await prisma.$queryRawUnsafe<Array<{ schema_name: string }>>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'bse%' ORDER BY schema_name`
    ),
  });

  beforeAll(async () => {
    ({ app, appUrl } = await initApp());
    prisma = app.get(PrismaService);
    spaceId = (await createSpace({ name: 'public duplicate compensation' })).id;
    sourceBaseId = (await createBase({ spaceId, name: 'source base' })).id;
    await createTable(sourceBaseId, { name: 'first source table', fields: [
      { name: 'Name', type: FieldType.SingleLineText },
    ], records: [{ fields: { Name: 'source row' } }] });
    await createTable(sourceBaseId, { name: 'second source table', fields: [
      { name: 'Name', type: FieldType.SingleLineText },
    ] });
    for (const spaceIds of [[], [spaceId]]) {
      const issued = (await createAccessToken({ name: 'duplicate without delete', description: 'real PAT ceiling',
        scopes, baseIds: [sourceBaseId], ...(spaceIds.length ? { spaceIds } : {}),
        expiredTime: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
      })).data;
      tokenIds.push(issued.id);
      if (spaceIds.length) duplicateToken = issued;
      else sourceOnly = issued;
    }
  });
  afterAll(async () => {
    try {
      for (const id of tokenIds) await deleteAccessToken(id);
      if (spaceId) await permanentDeleteSpace(spaceId);
    } finally { await app?.close(); }
  });

  it('rejects a source-only PAT before allocating destination metadata or schema', async () => {
    const before = await state();
    const response = await duplicate('source scope must not allocate', sourceOnly.token);
    expect(response.status).toBe(403);
    expect(await state()).toEqual(before);
  });

  it('duplicates under genuine create scopes without granting table delete', async () => {
    expect(scopes).not.toContain('table|delete');
    const response = await duplicate('successful copy without delete scope');
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.base.id).not.toBe(sourceBaseId);
    expect(Object.values(body.data.tableIdMap)).toHaveLength(2);
    expect(await prisma.tableMeta.count({ where: { baseId: body.data.base.id, deletedTime: null } })).toBe(2);
  });

  it('cleans actual committed duplicate tables and base schema after a nested duplication failure', async () => {
    const before = await state();
    let committedTableId: string | undefined;
    const original = DuplicateBaseHandler.prototype.handle;
    const fault = vi.spyOn(DuplicateBaseHandler.prototype, 'handle').mockImplementation(async function (this: DuplicateBaseHandler, context, command) {
      const result = await original.call(this, context, command);
      if (result.isErr()) return result;
      return ok((async function* (): AsyncGenerator<DuplicateBaseEvent> {
        for await (const event of result.value) {
          if (event.id === 'progress' && event.phase === 'table_structure_done') {
            committedTableId = event.tableId;
            yield { id: 'error', code: 'test.duplicate_failure_after_commit', message: 'Injected failure after native table creation' };
            return;
          }
          yield event;
        }
      })());
    });
    try {
      const response = await duplicate('must compensate actual native tables');
      expect(response.status).toBe(500);
      expect(committedTableId).toEqual(expect.any(String));
      expect(await state()).toEqual(before);
      expect(await prisma.tableMeta.count({ where: { id: committedTableId! } })).toBe(0);
    } finally { fault.mockRestore(); }
  });

  it('removes allocated base metadata when schema provisioning throws before native table duplication', async () => {
    const before = await state();
    const provider = app.select(BaseModule).get<IDbProvider>(DB_PROVIDER_SYMBOL, { strict: true });
    const fault = vi.spyOn(provider, 'createSchema').mockImplementationOnce(() => {
      throw new Error('Injected schema provisioning failure');
    });
    try {
      const response = await duplicate('must compensate provisioning metadata');
      expect(response.status).toBe(500);
      expect(fault).toHaveBeenCalledTimes(1);
      expect(await state()).toEqual(before);
    } finally { fault.mockRestore(); }
  });
});
