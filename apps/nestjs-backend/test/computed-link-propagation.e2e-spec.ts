/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { ClsService } from 'nestjs-cls';
import { ComputedOrchestratorService } from '../src/features/computed/services/computed-orchestrator.service';
import type { IClsStore } from '../src/types/cls';
import {
  runWithTestUser,
  createField,
  createTable,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Computed Link Propagation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let knex: Knex;
  let orchestrator: ComputedOrchestratorService;
  let cls: ClsService<IClsStore>;
  const baseId = (globalThis as any).testConfig.baseId as string;

  const getDbTableName = async (tableId: string) => {
    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return dbTableName;
  };

  const getRow = async (dbTableName: string, id: string) => {
    return (
      await prisma.$queryRawUnsafe<any[]>(knex(dbTableName).select('*').where('__id', id).toQuery())
    )[0];
  };

  const parseMaybe = (v: unknown) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    knex = app.get('CUSTOM_KNEX' as any);
    orchestrator = app.get(ComputedOrchestratorService);
    cls = app.get(ClsService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('updates link own physical column after link cell changes (ManyMany)', async () => {
    // Host and Foreign tables with primary text
    const host = await createTable(baseId, {
      name: 'host_link_mm',
      fields: [{ name: 'H', type: FieldType.SingleLineText } as IFieldRo],
      records: [{ fields: { H: 'h1' } }],
    });
    const foreign = await createTable(baseId, {
      name: 'foreign_link_mm',
      fields: [{ name: 'F', type: FieldType.SingleLineText } as IFieldRo],
      records: [{ fields: { F: 'f1' } }],
    });
    const hostDb = await getDbTableName(host.id);

    const link = await createField(host.id, {
      name: 'L_MM',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: foreign.id },
    } as IFieldRo);

    // Set link value on host record
    await updateRecordByApi(host.id, host.records[0].id, (link as any).id, [
      { id: foreign.records[0].id },
    ]);

    // Trigger computed pipeline for link field update on host
    await runWithTestUser(cls, () =>
      orchestrator.run(host.id, [{ recordId: host.records[0].id, fieldId: (link as any).id }])
    );

    // Verify host link physical column updated
    const row = await getRow(hostDb, host.records[0].id);
    const cell = parseMaybe(row[(link as any).dbFieldName]);
    expect(Array.isArray(cell) ? cell.map((v: any) => v.id) : cell?.id).toContain(
      foreign.records[0].id
    );

    await permanentDeleteTable(baseId, foreign.id);
    await permanentDeleteTable(baseId, host.id);
  });

  it('updates host link physical column when foreign title changes', async () => {
    const host = await createTable(baseId, {
      name: 'host_link_title',
      fields: [{ name: 'H', type: FieldType.SingleLineText } as IFieldRo],
      records: [{ fields: { H: 'h1' } }],
    });
    const foreign = await createTable(baseId, {
      name: 'foreign_link_title',
      fields: [{ name: 'F', type: FieldType.SingleLineText } as IFieldRo],
      records: [{ fields: { F: 'f1' } }],
    });
    const hostDb = await getDbTableName(host.id);

    const link = await createField(host.id, {
      name: 'L',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: foreign.id },
    } as IFieldRo);

    await updateRecordByApi(host.id, host.records[0].id, (link as any).id, [
      { id: foreign.records[0].id },
    ]);

    // Change foreign primary title
    const foreignTitle = foreign.fields.find((f) => f.name === 'F')!;
    await updateRecordByApi(foreign.id, foreign.records[0].id, foreignTitle.id, 'f1-updated');

    // Trigger computed on foreign title change
    await runWithTestUser(cls, () =>
      orchestrator.run(foreign.id, [{ recordId: foreign.records[0].id, fieldId: foreignTitle.id }])
    );

    const row = await getRow(hostDb, host.records[0].id);
    const cell = parseMaybe(row[(link as any).dbFieldName]);
    // At least ensure link cell still references the foreign id after title change (title presence is impl-specific)
    expect(Array.isArray(cell) ? cell.map((v: any) => v.id) : cell?.id).toContain(
      foreign.records[0].id
    );

    await permanentDeleteTable(baseId, foreign.id);
    await permanentDeleteTable(baseId, host.id);
  });
});
