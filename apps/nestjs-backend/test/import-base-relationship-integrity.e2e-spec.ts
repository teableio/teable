/* eslint-disable @typescript-eslint/naming-convention */
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentItem, IFieldVo, ILinkFieldOptions } from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  NotificationSeverityEnum,
  NotificationTypeEnum,
  Relationship,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson, IImportBaseVo, INotifyVo, ITableFullVo } from '@teable/openapi';
import { exportBase, getFields, getTableList } from '@teable/openapi';
import archiver from 'archiver';
import { stringify } from 'csv-stringify/sync';
import type { ClsStore } from 'nestjs-cls';
import { ClsService } from 'nestjs-cls';
import Papa from 'papaparse';
import { Client } from 'pg';
import * as unzipper from 'unzipper';
import { postgresAddForeignKeyNotValidSql } from '../src/db-provider/postgres-fk-delete-action';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { AttachmentsService } from '../src/features/attachments/attachments.service';
import { BaseImportCsvQueueProcessor } from '../src/features/base/base-import-processor/base-import-csv.processor';
import { BaseImportJunctionCsvQueueProcessor } from '../src/features/base/base-import-processor/base-import-junction.processor';
import { DataDbClientManager } from '../src/global/data-db-client-manager.service';
import { createAwaitWithEventWithResult } from './utils/event-promise';
import {
  createBase,
  createField,
  createTable,
  getRecords,
  initApp,
  permanentDeleteBase,
  updateRecordByApi,
} from './utils/init-app';

type ArchiveTable = IBaseJson['tables'][number];
type ArchiveCsv = { columns: string[]; rows: Record<string, string>[] };
type ArchiveFixture = { structure: IBaseJson; entries: Map<string, Buffer> };

const named = <T extends { name: string }>(items: readonly T[], name: string): T => {
  const item = items.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Missing fixture field or table: ${name}`);
  return item;
};

const readCsv = (fixture: ArchiveFixture, table: ArchiveTable): ArchiveCsv => {
  const bytes = fixture.entries.get(`tables/${table.id}.csv`);
  if (!bytes) throw new Error('Missing fixture table CSV');
  const parsed = Papa.parse<Record<string, string>>(bytes.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
  });
  expect(parsed.errors).toEqual([]);
  return { columns: parsed.meta.fields ?? [], rows: parsed.data };
};

const writeCsv = (fixture: ArchiveFixture, table: ArchiveTable, csv: ArchiveCsv) => {
  fixture.entries.set(
    `tables/${table.id}.csv`,
    Buffer.from(stringify(csv.rows, { header: true, columns: csv.columns }))
  );
};

describe('public .tea relationship integrity (e2e)', () => {
  const spaceId = globalThis.testConfig.spaceId;
  const actorId = globalThis.testConfig.userId;
  const baseIds = new Set<string>();
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'false';
    const context = await initApp();
    app = context.app;
    appUrl = context.appUrl;
    cookie = context.cookie;
  });

  afterEach(async () => {
    const prisma = app.get(PrismaService);
    for (const baseId of baseIds) {
      // Import completion can leave computed work running against the fixture schema.
      await expect
        .poll(
          () =>
            prisma.computedUpdateOutbox.count({
              where: { baseId, status: { in: ['pending', 'processing'] } },
            }),
          { timeout: 30_000, message: `Computed work did not drain for base ${baseId}` }
        )
        .toBe(0);
      await permanentDeleteBase(baseId);
    }
    baseIds.clear();
  });

  afterAll(async () => {
    await app?.close();
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
  });

  const newBase = async (name: string, engine: 'v1' | 'v2' = 'v1') => {
    process.env.FORCE_V2_ALL = String(engine === 'v2');
    try {
      const base = await createBase({ name, spaceId });
      baseIds.add(base.id);
      // New bases default to V2 even with the global flag disabled. Select the physical
      // source schema before any table is created, not by changing the exported metadata.
      await app.get(PrismaService).base.update({
        where: { id: base.id },
        data: { v2Enabled: engine === 'v2' },
      });
      return base;
    } finally {
      process.env.FORCE_V2_ALL = 'false';
    }
  };

  const exportFixture = async (baseId: string): Promise<ArchiveFixture> => {
    const awaitExport = createAwaitWithEventWithResult<{ previewUrl: string }>(
      app.get(EventEmitterService),
      Events.BASE_EXPORT_COMPLETE
    );
    const { previewUrl } = await awaitExport(() => exportBase(baseId, { includeData: true }));
    const response = await fetch(appUrl + previewUrl);
    expect(response.ok).toBe(true);
    const directory = await unzipper.Open.buffer(Buffer.from(await response.arrayBuffer()));
    const entries = new Map<string, Buffer>();
    for (const file of directory.files) {
      if (file.type === 'File') entries.set(file.path, await file.buffer());
    }
    const structureBytes = entries.get('structure.json');
    if (!structureBytes) throw new Error('Export omitted structure.json');
    return { structure: JSON.parse(structureBytes.toString('utf8')) as IBaseJson, entries };
  };

  const packFixture = async ({ structure, entries }: ArchiveFixture): Promise<Buffer> => {
    const archive = archiver('zip', { zlib: { level: 0 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const { promise: finished, resolve, reject } = Promise.withResolvers<void>();
    archive.on('end', resolve);
    archive.on('error', reject);
    for (const [path, bytes] of entries) {
      archive.append(path === 'structure.json' ? JSON.stringify(structure) : bytes, { name: path });
    }
    await archive.finalize();
    await finished;
    return Buffer.concat(chunks);
  };

  const waitForQueue = async (
    queue: BaseImportCsvQueueProcessor['queue'] | BaseImportJunctionCsvQueueProcessor['queue'],
    jobId: string
  ) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'failed') {
          // The worker can fail after getJob reads its earlier metadata snapshot.
          const failedJob = await queue.getJob(jobId);
          throw new Error(`Import job failed: ${failedJob?.failedReason}`);
        }
        if (state === 'completed') return;
      }
      await delay(25);
    }
    throw new Error('Import job did not complete');
  };

  const importFixture = async (
    fixture: ArchiveFixture,
    engine: 'v1' | 'v2' = 'v1',
    onCreated?: (result: IImportBaseVo) => Promise<void>
  ) => {
    const bytes = await packFixture(fixture);
    const notify = await app.get(ClsService).runWith<Promise<IAttachmentItem>>(
      {
        user: {
          id: actorId,
          name: globalThis.testConfig.userName,
          email: globalThis.testConfig.email,
          isAdmin: null,
        },
      } as unknown as ClsStore,
      () =>
        app.get(AttachmentsService).uploadFromStream(Readable.from(bytes), {
          filename: 'relationship-integrity.tea',
          contentType: 'application/zip',
          contentLength: bytes.length,
        })
    );
    process.env.FORCE_V2_ALL = String(engine === 'v2');
    let response: Response;
    try {
      response = await fetch(`${appUrl}/api/base/import`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          'x-canary': String(engine === 'v2'),
        },
        body: JSON.stringify({ notify: notify as unknown as INotifyVo, spaceId }),
      });
    } finally {
      process.env.FORCE_V2_ALL = 'false';
    }
    const result = (await response.json()) as IImportBaseVo;
    if (result.base?.id) baseIds.add(result.base.id);
    expect(response.status, JSON.stringify(result)).toBe(201);
    expect(response.headers.get('x-teable-v2')).toBe(String(engine === 'v2'));
    await onCreated?.(result);
    if (engine === 'v1') {
      await waitForQueue(
        app.get(BaseImportCsvQueueProcessor).queue,
        `import_csv_${notify.path}_${actorId}`
      );
      // Only surviving links schedule a junction job in the legacy importer.
      const hasLinks = await app.get(PrismaService).field.findFirst({
        where: {
          tableId: { in: Object.values(result.tableIdMap) },
          type: FieldType.Link,
          OR: [{ isLookup: null }, { isLookup: false }],
        },
        select: { id: true },
      });
      if (hasLinks) {
        await waitForQueue(
          app.get(BaseImportJunctionCsvQueueProcessor).queue,
          `import_base_junction_csv_${notify.path}_${actorId}`
        );
      }
    }
    return result;
  };

  const expectSkippedLinkCells = async (baseId: string, expected: number) => {
    const deadline = Date.now() + 5000;
    let skippedLinkCells = 0;
    while (Date.now() < deadline) {
      const notifications = await app.get(PrismaService).notification.findMany({
        where: {
          toUserId: actorId,
          type: NotificationTypeEnum.System,
          severity: NotificationSeverityEnum.Warning,
          urlPath: `/base/${baseId}`,
        },
      });
      skippedLinkCells = notifications.reduce((sum, { messageI18n }) => {
        if (!messageI18n) return sum;
        const message = JSON.parse(messageI18n) as {
          i18nKey: string;
          context: { skippedUserCells: number; skippedLinkCells: number };
        };
        if (message.i18nKey !== 'notification.baseImport.skippedCells') return sum;
        expect(message.context.skippedUserCells).toBe(0);
        return sum + message.context.skippedLinkCells;
      }, 0);
      if (skippedLinkCells >= expected) break;
      await delay(25);
    }
    expect(skippedLinkCells).toBe(expected);
  };

  it('preserves a self oneOne driver, inverse and empty cells with explicit isOneWay false', async () => {
    const source = await newBase('Self relation source');
    const table = await createTable(source.id, {
      name: 'Self relation rows',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: ['A', 'B', 'Empty'].map((Name) => ({ fields: { Name } })),
    });
    const forward = await createField(table.id, {
      name: 'Forward',
      type: FieldType.Link,
      options: { foreignTableId: table.id, relationship: Relationship.OneOne, isOneWay: false },
    });
    const forwardOptions = forward.options as ILinkFieldOptions;
    const reverse = (await getFields(table.id)).data.find(
      (field) => field.id === forwardOptions.symmetricFieldId
    )!;
    const [a, b, empty] = table.records;
    await updateRecordByApi(table.id, a.id, forward.id, { id: b.id });

    const fixture = await exportFixture(source.id);
    const archivedTable = named(fixture.structure.tables, table.name);
    const archivedForward = named(archivedTable.fields, 'Forward');
    const archivedReverse = archivedTable.fields.find((field) => field.id === reverse.id)!;
    const archivedForwardOptions = archivedForward.options as ILinkFieldOptions;
    const archivedReverseOptions = archivedReverse.options as ILinkFieldOptions;
    // Both values are explicitly false in this valid archive. Field order must not pick the driver.
    archivedForwardOptions.isOneWay = false;
    archivedReverseOptions.isOneWay = false;
    archivedTable.fields = [
      ...archivedTable.fields.filter((field) => field.type !== FieldType.Link),
      archivedForward,
      archivedReverse,
    ];
    expect(archivedForwardOptions).toMatchObject({
      foreignTableId: table.id,
      fkHostTableName: table.dbTableName,
      selfKeyName: '__id',
      foreignKeyName: `__fk_${forward.id}`,
      symmetricFieldId: reverse.id,
    });
    expect(archivedReverseOptions).toMatchObject({
      foreignTableId: table.id,
      fkHostTableName: table.dbTableName,
      selfKeyName: archivedForwardOptions.foreignKeyName,
      foreignKeyName: '__id',
      symmetricFieldId: forward.id,
    });
    expect([...fixture.entries.keys()].some((path) => path.includes('junction_'))).toBe(false);
    const csv = readCsv(fixture, archivedTable);
    expect(csv.columns).toContain(archivedForwardOptions.foreignKeyName);
    expect(csv.rows.map((row) => [row.__id, row[archivedForwardOptions.foreignKeyName]])).toEqual([
      [a.id, b.id],
      [b.id, ''],
      [empty.id, ''],
    ]);
    // Canonical source caches are fixture data, not the oracle for imported computed cells.
    for (const row of csv.rows) {
      row[archivedForward.dbFieldName] =
        row.__id === a.id ? JSON.stringify({ id: b.id, title: 'B' }) : '';
      row[archivedReverse.dbFieldName] =
        row.__id === b.id ? JSON.stringify({ id: a.id, title: 'A' }) : '';
    }
    writeCsv(fixture, archivedTable, csv);

    const result = await importFixture(fixture);
    const importedTable = named((await getTableList(result.base.id)).data, table.name);
    const fields = (await getFields(importedTable.id)).data;
    const importedForward = named(fields, 'Forward');
    const importedReverse = fields.find((field) => field.id === result.fieldIdMap[reverse.id])!;
    const options = importedForward.options as ILinkFieldOptions;
    expect(options).toMatchObject({
      relationship: Relationship.OneOne,
      foreignTableId: importedTable.id,
      selfKeyName: '__id',
      foreignKeyName: `__fk_${importedForward.id}`,
      symmetricFieldId: importedReverse.id,
    });
    expect(importedReverse.options).toMatchObject({
      selfKeyName: options.foreignKeyName,
      foreignKeyName: '__id',
      symmetricFieldId: importedForward.id,
    });
    const knex = await app.get(DataDbClientManager).dataKnexForBase(result.base.id);
    const physical = await knex(importedTable.dbTableName)
      .select({
        id: '__id',
        name: named(fields, 'Name').dbFieldName,
        fk: options.foreignKeyName,
        forward: importedForward.dbFieldName,
        reverse: importedReverse.dbFieldName,
      })
      .orderBy(named(fields, 'Name').dbFieldName);
    expect(physical).toEqual([
      { id: a.id, name: 'A', fk: b.id, forward: { id: b.id, title: 'B' }, reverse: null },
      { id: b.id, name: 'B', fk: null, forward: null, reverse: { id: a.id, title: 'A' } },
      { id: empty.id, name: 'Empty', fk: null, forward: null, reverse: null },
    ]);
    const api = await getRecords(importedTable.id, { fieldKeyType: FieldKeyType.Id });
    expect(api.records).toHaveLength(3);
    for (const row of physical) {
      const record = api.records.find(({ id }) => id === row.id)!;
      expect(record.fields[importedForward.id] ?? null).toEqual(row.forward);
      expect(record.fields[importedReverse.id] ?? null).toEqual(row.reverse);
    }
  }, 60_000);

  it('preserves cached formulas downstream of a disconnected rollup on V1 import', async () => {
    const source = await newBase('Disconnected formula source');
    const targets = await createTable(source.id, {
      name: 'Scores',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Score', type: FieldType.Number },
      ],
      records: [{ fields: { Name: 'First', Score: 11 } }],
    });
    const hosts = await createTable(source.id, {
      name: 'Totals',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'First' } }],
    });
    const link = await createField(hosts.id, {
      name: 'Related',
      type: FieldType.Link,
      options: { foreignTableId: targets.id, relationship: Relationship.ManyMany, isOneWay: true },
    });
    await updateRecordByApi(hosts.id, hosts.records[0].id, link.id, [{ id: targets.records[0].id }]);
    const total = await createField(hosts.id, {
      name: 'Total',
      type: FieldType.Rollup,
      options: { expression: 'sum({values})' },
      lookupOptions: {
        foreignTableId: targets.id,
        lookupFieldId: named(targets.fields, 'Score').id,
        linkFieldId: link.id,
      },
    });
    const next = await createField(hosts.id, {
      name: 'Next',
      type: FieldType.Formula,
      options: { expression: `{${total.id}} + 1` },
    });
    const chained = await createField(hosts.id, {
      name: 'Chained',
      type: FieldType.Formula,
      options: { expression: `{${next.id}} + 8` },
    });
    await createField(hosts.id, {
      name: 'Independent',
      type: FieldType.Formula,
      options: { expression: '2 + 3' },
    });
    const fixture = await exportFixture(source.id);
    const host = named(fixture.structure.tables, hosts.name);
    expect(readCsv(fixture, host).rows[0]).toMatchObject({
      [total.dbFieldName]: '11',
      [next.dbFieldName]: '12',
      [chained.dbFieldName]: '20',
    });
    fixture.structure.tables = [host];
    fixture.structure.nodes = fixture.structure.nodes.filter(
      (node) => node.resourceId !== targets.id
    );
    fixture.entries.delete(`tables/${targets.id}.csv`);

    const imported = await importFixture(fixture, 'v1');
    const tableId = imported.tableIdMap[hosts.id];
    const fields = (await getFields(tableId)).data;
    for (const name of ['Total', 'Next', 'Chained']) {
      expect(named(fields, name).type).toBe(FieldType.SingleLineText);
    }
    expect(named(fields, 'Independent').type).toBe(FieldType.Formula);
    const rows = await getRecords(tableId, { fieldKeyType: FieldKeyType.Name });
    expect(rows.records.map((row) => row.fields)).toMatchObject([
      { Name: 'First', Total: '11', Next: '12', Chained: '20', Independent: 5 },
    ]);
  }, 120_000);

  it('counts every V2 table-only manyMany source cell in either table order while retaining V1 edges and rollups', async () => {
    const source = await newBase('V2 relationship source', 'v2');
    const targets = await createTable(source.id, {
      name: 'Relation targets',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Score', type: FieldType.Number },
      ],
      records: [
        { fields: { Name: 'First', Score: 3 } },
        { fields: { Name: 'Second', Score: 4 } },
        { fields: { Name: 'Unused', Score: 9 } },
      ],
    });
    const hosts = await createTable(source.id, {
      name: 'Relation hosts',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: ['Both', 'Single', 'Empty', 'Removed host'].map((Name) => ({ fields: { Name } })),
    });
    const links: IFieldVo[] = [];
    for (const [name, relationship, isOneWay] of [
      ['Two Way', Relationship.ManyMany, false],
      ['One Way', Relationship.ManyMany, true],
      ['Parent', Relationship.ManyOne, false],
    ] as const) {
      links.push(
        await createField(hosts.id, {
          name,
          type: FieldType.Link,
          options: { foreignTableId: targets.id, relationship, isOneWay },
        })
      );
    }
    const [twoWay, oneWay, parent] = links;
    const [first, second, unused] = targets.records;
    const [both, single, empty, removedHost] = hosts.records;
    for (const link of [twoWay, oneWay]) {
      await updateRecordByApi(hosts.id, both.id, link.id, [{ id: first.id }, { id: second.id }]);
      await updateRecordByApi(hosts.id, single.id, link.id, [{ id: first.id }]);
      await createField(hosts.id, {
        name: `${link.name} Total`,
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: targets.id,
          linkFieldId: link.id,
          lookupFieldId: named(targets.fields, 'Score').id,
        },
      });
    }
    await updateRecordByApi(hosts.id, removedHost.id, twoWay.id, [{ id: second.id }]);
    for (const host of [both, single]) {
      await updateRecordByApi(hosts.id, host.id, parent.id, { id: first.id });
    }
    const self = await createField(hosts.id, {
      name: 'Self Related',
      type: FieldType.Link,
      options: {
        foreignTableId: hosts.id,
        relationship: Relationship.ManyMany,
        isOneWay: false,
      },
    });
    await updateRecordByApi(hosts.id, both.id, self.id, [{ id: single.id }]);
    const fixture = await exportFixture(source.id);
    expect(
      await app.get(PrismaService).base.findUniqueOrThrow({
        where: { id: source.id },
        select: { v2Enabled: true },
      })
    ).toMatchObject({ v2Enabled: true });
    const dataPaths = [...fixture.entries.keys()].filter((path) => path.startsWith('tables/'));
    expect(dataPaths.sort()).toEqual([`tables/${hosts.id}.csv`, `tables/${targets.id}.csv`].sort());
    const archivedHosts = named(fixture.structure.tables, hosts.name);
    const archivedTargets = named(fixture.structure.tables, targets.name);
    const hostCsv = readCsv(fixture, archivedHosts);
    for (const link of [twoWay, oneWay]) {
      const cell = hostCsv.rows.find((row) => row.__id === both.id)?.[link.dbFieldName];
      expect(JSON.parse(cell!)).toEqual([
        { id: first.id, title: 'First' },
        { id: second.id, title: 'Second' },
      ]);
    }
    const missingIds = ['rec0000000000000000', 'rec0000000000000001'];
    for (const id of missingIds) {
      expect([...hosts.records, ...targets.records].map(({ id }) => id)).not.toContain(id);
    }
    const appendMissing = (row: Record<string, string>, column: string) => {
      row[column] = JSON.stringify([
        ...JSON.parse(row[column] || '[]'),
        ...missingIds.map((id) => ({ id })),
        { id: missingIds[0] },
      ]);
    };
    for (const id of [both.id, single.id, empty.id]) {
      for (const link of [twoWay, oneWay]) {
        appendMissing(
          hostCsv.rows.find((row) => row.__id === id)!,
          link.dbFieldName
        );
      }
    }
    const selfInverseId = (self.options as ILinkFieldOptions).symmetricFieldId!;
    const archivedSelfInverse = archivedHosts.fields.find(({ id }) => id === selfInverseId)!;
    appendMissing(
      hostCsv.rows.find((row) => row.__id === both.id)!,
      self.dbFieldName
    );
    appendMissing(
      hostCsv.rows.find((row) => row.__id === single.id)!,
      archivedSelfInverse.dbFieldName
    );
    // Its surviving inverse cell references a missing target and counts once;
    // the removed source row itself contributes no archived cell.
    hostCsv.rows = hostCsv.rows.filter((row) => row.__id !== removedHost.id);
    writeCsv(fixture, archivedHosts, hostCsv);
    const targetCsv = readCsv(fixture, archivedTargets);
    const inverseId = (twoWay.options as ILinkFieldOptions).symmetricFieldId!;
    const archivedInverse = archivedTargets.fields.find(({ id }) => id === inverseId)!;
    appendMissing(
      targetCsv.rows.find((row) => row.__id === first.id)!,
      archivedInverse.dbFieldName
    );
    writeCsv(fixture, archivedTargets, targetCsv);

    for (const tableOrder of [
      [archivedTargets, archivedHosts],
      [archivedHosts, archivedTargets],
    ]) {
      fixture.structure.tables = tableOrder;
      const result = await importFixture(fixture);
      const tables = (await getTableList(result.base.id)).data;
      const importedHosts = named(tables, hosts.name);
      const importedTargets = named(tables, targets.name);
      const hostFields = (await getFields(importedHosts.id)).data;
      const targetFields = (await getFields(importedTargets.id)).data;
      const hostRecords = await getRecords(importedHosts.id, { fieldKeyType: FieldKeyType.Name });
      const targetRecords = await getRecords(importedTargets.id, { fieldKeyType: FieldKeyType.Id });
      expect(hostRecords.records.map(({ id }) => id).sort()).toEqual(
        [both.id, single.id, empty.id].sort()
      );
      expect(targetRecords.records.map(({ id }) => id).sort()).toEqual(
        [first.id, second.id, unused.id].sort()
      );
      const importedBoth = hostRecords.records.find(({ id }) => id === both.id)!;
      const importedSingle = hostRecords.records.find(({ id }) => id === single.id)!;
      const importedEmpty = hostRecords.records.find(({ id }) => id === empty.id)!;
      const linkIds = (value: unknown) =>
        ((value ?? []) as { id: string }[]).map(({ id }) => id).sort();
      for (const link of [twoWay, oneWay]) {
        expect(linkIds(importedBoth.fields[link.name])).toEqual([first.id, second.id].sort());
        expect(linkIds(importedSingle.fields[link.name])).toEqual([first.id]);
        expect(linkIds(importedEmpty.fields[link.name])).toEqual([]);
        expect(importedBoth.fields[`${link.name} Total`]).toBe(7);
        expect(importedSingle.fields[`${link.name} Total`]).toBe(3);
      }
      for (const host of [importedBoth, importedSingle]) {
        expect(host.fields.Parent).toEqual({ id: first.id, title: 'First' });
      }
      expect(importedEmpty.fields.Parent ?? null).toBeNull();
      for (const link of [twoWay, parent]) {
        const importedLink = named(hostFields, link.name);
        const inverseId = (importedLink.options as ILinkFieldOptions).symmetricFieldId!;
        const inverse = targetFields.find(({ id }) => id === inverseId)!;
        expect(inverse.options).toMatchObject({
          relationship: link.id === parent.id ? Relationship.OneMany : Relationship.ManyMany,
          symmetricFieldId: importedLink.id,
        });
        expect(
          linkIds(targetRecords.records.find(({ id }) => id === first.id)!.fields[inverse.id])
        ).toEqual([both.id, single.id].sort());
        expect(
          linkIds(targetRecords.records.find(({ id }) => id === unused.id)!.fields[inverse.id])
        ).toEqual([]);
      }
      const twoWayInverseId = (named(hostFields, 'Two Way').options as ILinkFieldOptions)
        .symmetricFieldId!;
      expect(
        linkIds(targetRecords.records.find(({ id }) => id === second.id)!.fields[twoWayInverseId])
      ).toEqual([both.id]);
      const selfInverse = hostFields.find(({ id }) => id === result.fieldIdMap[selfInverseId])!;
      const selfInverseName = selfInverse.name;
      expect(linkIds(importedBoth.fields['Self Related'])).toEqual([single.id]);
      expect(linkIds(importedSingle.fields[selfInverseName])).toEqual([both.id]);
      const oneWayOptions = named(hostFields, 'One Way').options as ILinkFieldOptions;
      expect(oneWayOptions.isOneWay).toBe(true);
      expect(oneWayOptions.symmetricFieldId).toBeUndefined();
      // Six host cells (including all-invalid cells), two opposite-side cells,
      // and two self-relation fields. IDs and inverse effects add no extra cells.
      await expectSkippedLinkCells(result.base.id, 10);
    }
  }, 120_000);

  it.each([
    { engine: 'v1', missingPointer: false },
    { engine: 'v1', missingPointer: true },
    { engine: 'v2', missingPointer: false },
  ] as const)(
    'keeps rows and legal edges while clearing dangling targets during $engine import (missing symmetric pointer: $missingPointer)',
    async ({ engine, missingPointer }) => {
      const source = await newBase('Dangling relation source');
      const targets = await createTable(source.id, {
        name: 'Dangling targets',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: ['Kept target', 'Removed target'].map((Name) => ({ fields: { Name } })),
      });
      const hosts = await createTable(source.id, {
        name: 'Dangling hosts',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: ['Mixed links', 'Dangling link', 'Empty link'].map((Name) => ({
          fields: { Name },
        })),
      });
      const many = await createField(hosts.id, {
        name: 'Related',
        type: FieldType.Link,
        options: {
          foreignTableId: targets.id,
          relationship: Relationship.ManyMany,
          isOneWay: false,
        },
      });
      const parent = await createField(hosts.id, {
        name: 'Parent',
        type: FieldType.Link,
        options: {
          foreignTableId: targets.id,
          relationship: Relationship.ManyOne,
          isOneWay: false,
        },
      });
      const [kept, removed] = targets.records;
      const [mixed, dangling, empty] = hosts.records;
      await updateRecordByApi(hosts.id, mixed.id, many.id, [{ id: kept.id }, { id: removed.id }]);
      await updateRecordByApi(hosts.id, mixed.id, parent.id, { id: kept.id });
      await updateRecordByApi(hosts.id, dangling.id, parent.id, { id: removed.id });
      const fixture = await exportFixture(source.id);
      const archivedTargets = named(fixture.structure.tables, targets.name);
      const targetCsv = readCsv(fixture, archivedTargets);
      expect(targetCsv.rows).toHaveLength(2);
      targetCsv.rows = targetCsv.rows.filter((row) => row.__id !== removed.id);
      writeCsv(fixture, archivedTargets, targetCsv);
      // Preserve the archive's link cells, physical FK and junction rows: only the target is absent.
      const hostCsv = readCsv(fixture, named(fixture.structure.tables, hosts.name));
      expect(
        hostCsv.rows.find((row) => row.__id === dangling.id)?.[
          (parent.options as ILinkFieldOptions).foreignKeyName
        ]
      ).toBe(removed.id);
      expect(
        JSON.parse(hostCsv.rows.find((row) => row.__id === mixed.id)![many.dbFieldName])
      ).toEqual([
        { id: kept.id, title: 'Kept target' },
        { id: removed.id, title: 'Removed target' },
      ]);

      if (missingPointer) {
        const archivedHosts = named(fixture.structure.tables, hosts.name);
        const related = named(archivedHosts.fields, many.name);
        delete (related.options as ILinkFieldOptions).symmetricFieldId;
      }
      const result = await importFixture(fixture, engine);
      const tables = (await getTableList(result.base.id)).data;
      const importedHosts = named(tables, hosts.name);
      const importedTargets = named(tables, targets.name);
      const hostRecords = await getRecords(importedHosts.id, { fieldKeyType: FieldKeyType.Name });
      const targetRecords = await getRecords(importedTargets.id, { fieldKeyType: FieldKeyType.Id });
      expect(hostRecords.records.map(({ id }) => id).sort()).toEqual(
        [mixed.id, dangling.id, empty.id].sort()
      );
      expect(targetRecords.records.map(({ id }) => id)).toEqual([kept.id]);
      const mixedRow = hostRecords.records.find(({ id }) => id === mixed.id)!;
      const danglingRow = hostRecords.records.find(({ id }) => id === dangling.id)!;
      const emptyRow = hostRecords.records.find(({ id }) => id === empty.id)!;
      expect(mixedRow.fields.Related).toEqual([{ id: kept.id, title: 'Kept target' }]);
      expect(mixedRow.fields.Parent).toEqual({ id: kept.id, title: 'Kept target' });
      for (const row of [danglingRow, emptyRow]) {
        expect(row.fields.Parent ?? null).toBeNull();
        expect(row.fields.Related ?? null).toBeNull();
      }
      const fields = (await getFields(importedHosts.id)).data;
      const targetFields = (await getFields(importedTargets.id)).data;
      for (const name of ['Related', 'Parent']) {
        const options = named(fields, name).options as ILinkFieldOptions;
        const inverse = targetFields.find(({ id }) => id === options.symmetricFieldId)!;
        expect(targetRecords.records[0].fields[inverse.id]).toEqual([
          { id: mixed.id, title: 'Mixed links' },
        ]);
      }
      const parentOptions = named(fields, 'Parent').options as ILinkFieldOptions;
      const knex = await app.get(DataDbClientManager).dataKnexForBase(result.base.id);
      const physical = await knex(importedHosts.dbTableName).select({
        id: '__id',
        fk: parentOptions.foreignKeyName,
      });
      expect(physical.find(({ id }) => id === mixed.id)?.fk).toBe(kept.id);
      expect(physical.find(({ id }) => id === dangling.id)?.fk).toBeNull();
      expect(physical.find(({ id }) => id === empty.id)?.fk).toBeNull();

      const deadline = Date.now() + 5000;
      let skippedLinkCells = 0;
      while (Date.now() < deadline) {
        const notifications = await app.get(PrismaService).notification.findMany({
          where: {
            toUserId: actorId,
            type: NotificationTypeEnum.System,
            severity: NotificationSeverityEnum.Warning,
            urlPath: `/base/${result.base.id}`,
          },
        });
        const warnings = notifications.flatMap(({ messageI18n }) => {
          if (!messageI18n) return [];
          const message = JSON.parse(messageI18n) as {
            i18nKey: string;
            context: { skippedUserCells: number; skippedLinkCells: number };
          };
          if (message.i18nKey !== 'notification.baseImport.skippedCells') return [];
          expect(Object.keys(message.context).sort()).toEqual([
            'skippedLinkCells',
            'skippedUserCells',
          ]);
          expect(message.context.skippedUserCells).toBe(0);
          for (const privateValue of [
            actorId,
            removed.id,
            'Removed target',
            mixed.id,
            'Mixed links',
          ]) {
            expect(messageI18n).not.toContain(String(privateValue));
          }
          return [message.context.skippedLinkCells];
        });
        skippedLinkCells = warnings.reduce((sum, count) => sum + count, 0);
        if (skippedLinkCells >= 2) break;
        await delay(25);
      }
      // A mixed multi-link cell counts once, plus the single dangling manyOne cell.
      expect(skippedLinkCells).toBe(2);
    },
    60_000
  );

  it.each([
    { engine: 'v1', isOneWay: false },
    { engine: 'v2', isOneWay: false },
    { engine: 'v2', isOneWay: true },
  ] as const)(
    'counts one V2 cell with 70001 missing targets once in $engine (one-way: $isOneWay)',
    async ({ engine, isOneWay }) => {
      const source = await newBase('Large synthetic reference source', 'v2');
      const targets = await createTable(source.id, {
        name: 'Large reference targets',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'Present target' } }],
      });
      const hosts = await createTable(source.id, {
        name: 'Large reference hosts',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'Preserved host' } }],
      });
      const link = await createField(hosts.id, {
        name: 'Related',
        type: FieldType.Link,
        options: {
          foreignTableId: targets.id,
          relationship: Relationship.ManyMany,
          isOneWay,
        },
      });
      const host = hosts.records[0];
      const target = targets.records[0];
      await updateRecordByApi(hosts.id, host.id, link.id, [{ id: target.id }]);
      const fixture = await exportFixture(source.id);
      expect(
        [...fixture.entries.keys()].filter((path) => path.startsWith('tables/')).sort()
      ).toEqual([`tables/${hosts.id}.csv`, `tables/${targets.id}.csv`].sort());
      const occupiedIds = new Set([host.id, target.id]);
      const missingIds: string[] = [];
      for (let index = 0; missingIds.length < 70_001; index++) {
        const id = `rec${String(index).padStart(16, '0')}`;
        if (!occupiedIds.has(id)) missingIds.push(id);
      }
      expect(new Set(missingIds).size).toBe(70_001);
      expect(missingIds.every((id) => /^rec\d{16}$/.test(id))).toBe(true);
      const archivedHosts = named(fixture.structure.tables, hosts.name);
      const archivedTargets = named(fixture.structure.tables, targets.name);
      // The target's symmetric cache is chosen for V1 reconstruction; the huge
      // source cell must still be read and counted independently of that cache.
      fixture.structure.tables = [archivedTargets, archivedHosts];
      const csv = readCsv(fixture, archivedHosts);
      expect(csv.rows).toHaveLength(1);
      const row = csv.rows.find(({ __id }) => __id === host.id);
      if (!row) throw new Error('Export omitted the synthetic host');
      // Only this JSON cell changes: a retained edge plus validly shaped missing IDs.
      row[link.dbFieldName] = JSON.stringify([
        { id: target.id, title: 'Present target' },
        ...missingIds.map((id) => ({ id })),
      ]);
      writeCsv(fixture, archivedHosts, csv);

      const result = await importFixture(fixture, engine);
      const importedHosts = await getRecords(result.tableIdMap[hosts.id], {
        fieldKeyType: FieldKeyType.Name,
      });
      const importedTargets = await getRecords(result.tableIdMap[targets.id], {
        fieldKeyType: FieldKeyType.Id,
      });
      expect(importedHosts.records).toHaveLength(1);
      expect(importedTargets.records).toHaveLength(1);
      expect(importedHosts.records[0]).toMatchObject({
        id: host.id,
        fields: {
          Name: 'Preserved host',
          Related: [{ id: target.id, title: 'Present target' }],
        },
      });
      expect(importedHosts.records[0].fields.Related).toEqual([
        { id: target.id, title: 'Present target' },
      ]);
      expect(importedTargets.records[0].id).toBe(target.id);
      if (!isOneWay) {
        const inverseId = (link.options as ILinkFieldOptions).symmetricFieldId!;
        expect(importedTargets.records[0].fields[result.fieldIdMap[inverseId]]).toEqual([
          { id: host.id, title: 'Preserved host' },
        ]);
      }
      await expectSkippedLinkCells(result.base.id, 1);
    },
    60_000
  );

  const assertSafeImportFailureNotification = async (
    baseId: string,
    failedReason: string | undefined,
    privateValues: readonly string[]
  ) => {
    const prisma = app.get(PrismaService);
    const deadline = Date.now() + 5000;
    let failureNotificationFound = false;
    while (Date.now() < deadline) {
      const notifications = await prisma.notification.findMany({
        where: {
          toUserId: actorId,
          type: NotificationTypeEnum.System,
          severity: NotificationSeverityEnum.Warning,
          urlPath: `/base/${baseId}`,
        },
      });
      for (const notification of notifications) {
        if (!notification.messageI18n) continue;
        const message = JSON.parse(notification.messageI18n) as { i18nKey?: string };
        if (message.i18nKey !== 'notification.baseImport.failed') continue;
        expect(message).toEqual({ i18nKey: 'notification.baseImport.failed' });
        const visibleFailure = JSON.stringify({
          message: notification.message,
          messageI18n: notification.messageI18n,
          failedReason,
        });
        for (const privateValue of privateValues) {
          expect(visibleFailure).not.toContain(privateValue);
        }
        expect(visibleFailure).not.toMatch(/ALTER TABLE|INSERT INTO|Prisma|23514|CHECK\s*\(/i);
        failureNotificationFound = true;
      }
      if (failureNotificationFound) break;
      await delay(25);
    }
    expect(failureNotificationFound).toBe(true);
  };

  it('fails a late V1 junction INSERT safely without partial edges or unhandled errors', async () => {
    const source = await newBase('Late relationship failure source');
    const targets = await createTable(source.id, {
      name: 'Late failure targets',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'Synthetic target' } }],
    });
    const hosts = await createTable(source.id, {
      name: 'Late failure hosts',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'Synthetic host' } }],
    });
    const link = await createField(hosts.id, {
      name: 'Related',
      type: FieldType.Link,
      options: {
        foreignTableId: targets.id,
        relationship: Relationship.ManyMany,
        isOneWay: false,
      },
    });
    const host = hosts.records[0];
    const target = targets.records[0];
    await updateRecordByApi(hosts.id, host.id, link.id, [{ id: target.id }]);
    const fixture = await exportFixture(source.id);
    expect([...fixture.entries.keys()].some((path) => path.includes('junction_'))).toBe(true);

    const queue = app.get(BaseImportJunctionCsvQueueProcessor).queue;
    const manager = app.get(DataDbClientManager);
    const constraintName = 't8537_synthetic_storage_denied';
    let imported: IImportBaseVo | undefined;
    let junctionTableName: string | undefined;
    await queue.pause();
    try {
      await expect(
        importFixture(fixture, 'v1', async (result) => {
          imported = result;
          const fields = (await getFields(result.tableIdMap[hosts.id])).data;
          const importedLink = fields.find(({ id }) => id === result.fieldIdMap[link.id]);
          if (!importedLink) throw new Error('Import omitted the fixture link field');
          junctionTableName = (importedLink.options as ILinkFieldOptions).fkHostTableName;
          expect(junctionTableName).toContain('junction_');
          const compiler = await manager.dataKnexForBase(result.base.id);
          const dataPrisma = await manager.dataPrismaForBase(result.base.id);
          const sql = compiler
            .raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (false) NOT VALID', [
              junctionTableName,
              constraintName,
            ])
            .toQuery();
          // Compile identifiers only; execute on this base's actual PostgreSQL client.
          await dataPrisma.$executeRawUnsafe(sql);
          await queue.resume();
        })
      ).rejects.toThrow(/^Import job failed: Base import relationship restoration failed$/);
      if (!imported || !junctionTableName)
        throw new Error('Import did not reach the SQL failure hook');
      const importedBaseId = imported.base.id;
      const failedJobs = (await queue.getJobs(['failed'])).filter(
        (job) => job.data.baseId === importedBaseId
      );
      expect(failedJobs).toHaveLength(1);
      expect(await failedJobs[0].getState()).toBe('failed');
      expect(failedJobs[0].failedReason).toBe('Base import relationship restoration failed');

      const importedHosts = await getRecords(imported.tableIdMap[hosts.id], {
        fieldKeyType: FieldKeyType.Name,
      });
      const importedTargets = await getRecords(imported.tableIdMap[targets.id], {
        fieldKeyType: FieldKeyType.Name,
      });
      expect(importedHosts.records.map(({ id, fields }) => ({ id, name: fields.Name }))).toEqual([
        { id: host.id, name: 'Synthetic host' },
      ]);
      expect(importedTargets.records.map(({ id, fields }) => ({ id, name: fields.Name }))).toEqual([
        { id: target.id, name: 'Synthetic target' },
      ]);
      const compiler = await manager.dataKnexForBase(importedBaseId);
      const dataPrisma = await manager.dataPrismaForBase(importedBaseId);
      const countSql = compiler
        .raw('SELECT count(*)::int AS count FROM ??', [junctionTableName])
        .toQuery();
      expect(await dataPrisma.$queryRawUnsafe<{ count: number }[]>(countSql)).toEqual([
        { count: 0 },
      ]);

      await assertSafeImportFailureNotification(importedBaseId, failedJobs[0].failedReason, [
        constraintName,
        junctionTableName,
        actorId,
        host.id,
        target.id,
        'Synthetic host',
        'Synthetic target',
      ]);
    } finally {
      await queue.resume();
    }
  }, 60_000);

  const postgresSqlState = (error: unknown): string | undefined => {
    if (error === null || typeof error !== 'object' || !('code' in error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
  };

  const createCsvRingFixture = async () => {
    const source = await newBase('CSV FK cycle source');
    const tables: ITableFullVo[] = [];
    for (const suffix of ['A', 'B', 'C']) {
      tables.push(
        await createTable(source.id, {
          name: `CSV cycle ${suffix}`,
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
          records: [{ fields: { Name: `Cycle ${suffix}` } }],
        })
      );
    }
    const links: IFieldVo[] = [];
    for (const [index, table] of tables.entries()) {
      links.push(
        await createField(table.id, {
          name: 'Next',
          type: FieldType.Link,
          options: {
            foreignTableId: tables[(index + 1) % tables.length].id,
            relationship: Relationship.ManyOne,
            isOneWay: false,
          },
        })
      );
    }
    return { source, tables, links };
  };

  // SQL-level scheduling probe: production executor and FK SQL generators, not handleChunk
  // or an assertion that an uninstrumented HTTP request deterministically creates this lock graph.
  it('serializes mixed CSV FK DDL through the real per-job executor without PostgreSQL 40P01', async () => {
    const { source, tables, links } = await createCsvRingFixture();
    const manager = app.get(DataDbClientManager);
    const compiler = await manager.dataKnexForBase(source.id);
    const dataPrisma = await manager.dataPrismaForBase(source.id);
    const route = await manager.getDataDatabaseForBase(source.id);
    const clients = tables.map(() => new Client({ connectionString: route.connectionUrl }));
    const statements: Array<{ drop: string; add: string; insert: string; update: string }> = [];
    for (const [index, table] of tables.entries()) {
      const foreignTable = tables[(index + 1) % tables.length];
      const options = links[index].options as ILinkFieldOptions;
      const constraints = await dataPrisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT conname AS name FROM pg_constraint
         WHERE contype = 'f' AND conrelid = $1::regclass AND confrelid = $2::regclass`,
        compiler.ref(table.dbTableName).toQuery(),
        compiler.ref(foreignTable.dbTableName).toQuery()
      );
      expect(constraints).toHaveLength(1);
      const constraintName = constraints[0].name;
      const drop = compiler.schema
        .alterTable(table.dbTableName, (builder) => {
          builder.dropForeign(options.foreignKeyName, constraintName);
        })
        .toQuery();
      const [schema, tableName] = table.dbTableName.split('.');
      const [referencedTableSchema, referencedTableName] = foreignTable.dbTableName.split('.');
      const add = postgresAddForeignKeyNotValidSql(compiler, {
        schema,
        tableName,
        constraintName,
        columnName: options.foreignKeyName,
        referencedTableSchema,
        referencedTableName,
        referencedColumnName: '__id',
        deleteRule: 'NO ACTION',
      });
      const rows = await dataPrisma.$queryRawUnsafe<Record<string, unknown>[]>(
        compiler(table.dbTableName).select('*').toQuery()
      );
      expect(rows).toHaveLength(1);
      statements.push({
        drop,
        add,
        insert: compiler(table.dbTableName).insert(rows[0]).toQuery(),
        update: compiler(table.dbTableName)
          .where('__id', table.records[0].id)
          .update({ [options.foreignKeyName]: foreignTable.records[0].id })
          .toQuery(),
      });
    }
    // The third session represents the real post-commit ADD stage, not a third DROP.
    await dataPrisma.$executeRawUnsafe(statements[2].drop);
    for (const table of tables) {
      await dataPrisma.$executeRawUnsafe(compiler(table.dbTableName).delete().toQuery());
    }
    const [probeSchema] = tables[0].dbTableName.split('.');
    const witnessTable = `${probeSchema}.t8537_csv_rollback_witness`;
    await dataPrisma.$executeRawUnsafe(
      compiler.raw('CREATE TABLE ?? (task integer PRIMARY KEY)', [witnessTable]).toQuery()
    );
    // Invoke the private executor used by the real per-job BatchProcessor, not a copied queue.
    const processor = app.get(BaseImportCsvQueueProcessor) as unknown as {
      createChunkExecutor(): (task: () => Promise<void>) => Promise<void>;
    };
    const execute = processor.createChunkExecutor();
    const release = Promise.withResolvers<void>();
    const firstStarted = Promise.withResolvers<void>();
    const started: Array<{ ready: Promise<void>; hasOwnerLock: boolean }> = [];
    let settled: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await Promise.all(clients.map((client) => client.connect()));
      const tasks = clients.map((client, index) =>
        execute(async () => {
          const ready = Promise.withResolvers<void>();
          const observation = { ready: ready.promise, hasOwnerLock: false };
          started.push(observation);
          firstStarted.resolve();
          try {
            await client.query('BEGIN');
            // Only a failing deadline, never a timeout-dependent success branch.
            await client.query("SET LOCAL statement_timeout = '10s'");
            const ownerMode = index === 2 ? 'SHARE ROW EXCLUSIVE' : 'ACCESS EXCLUSIVE';
            await client.query(
              compiler
                .raw(`LOCK TABLE ?? IN ${ownerMode} MODE`, [tables[index].dbTableName])
                .toQuery()
            );
            observation.hasOwnerLock = true;
            ready.resolve();
            await release.promise;
            // A separate FK-free witness avoids acquiring referenced-table locks via INSERT
            // triggers before the actual two DROP / one ADD deadlock statements run.
            await client.query(compiler(witnessTable).insert({ task: index }).toQuery());
            if (index === 2) {
              await client.query(statements[index].insert);
              await client.query(statements[index].update);
              await client.query(statements[index].add);
            } else {
              await client.query(statements[index].drop);
              await client.query(statements[index].insert);
              await client.query(statements[index].update);
            }
            await client.query('COMMIT');
          } catch (error) {
            ready.resolve();
            await client.query('ROLLBACK');
            throw error;
          }
        })
      );
      settled = Promise.allSettled(tasks);
      await firstStarted.promise;
      // Eager starts all three synchronously; a tail starts only the first. Do not
      // wait for a second task: it correctly cannot start under serialization.
      const active = [...started];
      await Promise.all(active.map(({ ready }) => ready));
      expect(active.every(({ hasOwnerLock }) => hasOwnerLock)).toBe(true);
      release.resolve();
      const results = await settled;
      const codes = results.map((result) =>
        result.status === 'rejected' ? postgresSqlState(result.reason) : null
      );
      if (results.some((result) => result.status === 'rejected')) {
        // Failures must actually be the customer's SQLSTATE, not a CHECK failpoint.
        expect(codes).toContain('40P01');
        for (const [index, result] of results.entries()) {
          if (result.status !== 'rejected') continue;
          expect(
            await dataPrisma.$queryRawUnsafe<{ count: number }[]>(
              compiler
                .raw('SELECT count(*)::int AS count FROM ??', [tables[index].dbTableName])
                .toQuery()
            )
          ).toEqual([{ count: 0 }]);
          expect(
            await dataPrisma.$queryRawUnsafe<{ count: number }[]>(
              compiler
                .raw('SELECT count(*)::int AS count FROM ?? WHERE task = ?', [witnessTable, index])
                .toQuery()
            )
          ).toEqual([{ count: 0 }]);
        }
      }
      expect(
        results.map(({ status }) => status),
        `PostgreSQL SQLSTATEs: ${JSON.stringify(codes)}`
      ).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
      // DROP work commits before these restorations, as in the CSV processor.
      await dataPrisma.$executeRawUnsafe(statements[0].add);
      await dataPrisma.$executeRawUnsafe(statements[1].add);
      for (const [index, table] of tables.entries()) {
        const options = links[index].options as ILinkFieldOptions;
        expect(
          await dataPrisma.$queryRawUnsafe<{ id: string; fk: string }[]>(
            compiler(table.dbTableName).select({ id: '__id', fk: options.foreignKeyName }).toQuery()
          )
        ).toEqual([
          { id: table.records[0].id, fk: tables[(index + 1) % tables.length].records[0].id },
        ]);
      }
    } finally {
      release.resolve();
      if (settled) await settled;
      await Promise.all(clients.map((client) => client.end()));
      await dataPrisma.$executeRawUnsafe(compiler.schema.dropTable(witnessTable).toQuery());
    }
  }, 60_000);

  it('restores all three V1 CSV tables and cyclic FK caches through HTTP import', async () => {
    const { source, tables, links } = await createCsvRingFixture();
    for (const [index, table] of tables.entries()) {
      await updateRecordByApi(table.id, table.records[0].id, links[index].id, {
        id: tables[(index + 1) % tables.length].records[0].id,
      });
    }
    const fixture = await exportFixture(source.id);
    expect([...fixture.entries.keys()].filter((path) => path.startsWith('tables/')).sort()).toEqual(
      tables.map(({ id }) => `tables/${id}.csv`).sort()
    );
    const result = await importFixture(fixture);
    const importedTables = (await getTableList(result.base.id)).data;
    expect(importedTables).toHaveLength(3);
    const manager = app.get(DataDbClientManager);
    const compiler = await manager.dataKnexForBase(result.base.id);
    const dataPrisma = await manager.dataPrismaForBase(result.base.id);
    for (const [index, table] of tables.entries()) {
      const importedTable = importedTables.find(({ id }) => id === result.tableIdMap[table.id])!;
      const fields = (await getFields(importedTable.id)).data;
      const forward = fields.find(({ id }) => id === result.fieldIdMap[links[index].id])!;
      const previousIndex = (index + tables.length - 1) % tables.length;
      const sourceReverseId = (links[previousIndex].options as ILinkFieldOptions).symmetricFieldId!;
      const reverse = fields.find(({ id }) => id === result.fieldIdMap[sourceReverseId])!;
      const next = tables[(index + 1) % tables.length];
      const previous = tables[previousIndex];
      const api = await getRecords(importedTable.id, { fieldKeyType: FieldKeyType.Id });
      expect(api.records).toHaveLength(1);
      expect(api.records[0].id).toBe(table.records[0].id);
      expect(api.records[0].fields[forward.id]).toEqual({
        id: next.records[0].id,
        title: `Cycle ${String.fromCharCode(65 + ((index + 1) % tables.length))}`,
      });
      expect(api.records[0].fields[reverse.id]).toEqual([
        {
          id: previous.records[0].id,
          title: `Cycle ${String.fromCharCode(65 + previousIndex)}`,
        },
      ]);
      const rows = await dataPrisma.$queryRawUnsafe<Record<string, unknown>[]>(
        compiler(importedTable.dbTableName)
          .select({
            id: '__id',
            fk: (forward.options as ILinkFieldOptions).foreignKeyName,
            forward: forward.dbFieldName,
            reverse: reverse.dbFieldName,
          })
          .toQuery()
      );
      expect(rows).toEqual([
        {
          id: table.records[0].id,
          fk: next.records[0].id,
          forward: api.records[0].fields[forward.id],
          reverse: api.records[0].fields[reverse.id],
        },
      ]);
    }
    const notifications = await app.get(PrismaService).notification.findMany({
      where: {
        toUserId: actorId,
        type: NotificationTypeEnum.System,
        urlPath: `/base/${result.base.id}`,
      },
    });
    expect(
      notifications.map(({ messageI18n }) => JSON.parse(messageI18n ?? '{}').i18nKey)
    ).not.toContain('notification.baseImport.failed');
  }, 60_000);

  it('rolls back a real CSV INSERT failure and does not start later table chunks', async () => {
    const source = await newBase('CSV transaction failure source');
    const first = await createTable(source.id, {
      name: 'First CSV transaction',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'Synthetic failing row' } }],
    });
    const later = await createTable(source.id, {
      name: 'Later CSV transaction',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'Synthetic queued row' } }],
    });
    const fixture = await exportFixture(source.id);
    const paths = [first, later].map(({ id }) => `tables/${id}.csv`);
    const orderedEntries = new Map([...fixture.entries].filter(([path]) => !paths.includes(path)));
    for (const path of paths) {
      const content = fixture.entries.get(path);
      if (!content) throw new Error('Export omitted a CSV failure fixture table');
      orderedEntries.set(path, content);
    }
    fixture.entries = orderedEntries;
    const queue = app.get(BaseImportCsvQueueProcessor).queue;
    const manager = app.get(DataDbClientManager);
    const constraintName = 't8537_csv_storage_denied';
    let imported: IImportBaseVo | undefined;
    await queue.pause();
    try {
      await expect(
        importFixture(fixture, 'v1', async (result) => {
          imported = result;
          const tables = (await getTableList(result.base.id)).data;
          const firstTable = tables.find(({ id }) => id === result.tableIdMap[first.id])!;
          const compiler = await manager.dataKnexForBase(result.base.id);
          const dataPrisma = await manager.dataPrismaForBase(result.base.id);
          await dataPrisma.$executeRawUnsafe(
            compiler
              .raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (false) NOT VALID', [
                firstTable.dbTableName,
                constraintName,
              ])
              .toQuery()
          );
          await queue.resume();
        })
      ).rejects.toThrow(/^Import job failed: Base import CSV processing failed$/);
      if (!imported) throw new Error('Import did not create the CSV failure base');
      const baseId = imported.base.id;
      const failed = (await queue.getJobs(['failed'])).filter((job) => job.data.baseId === baseId);
      expect(failed).toHaveLength(1);
      expect(await failed[0].getState()).toBe('failed');
      expect(failed[0].failedReason).toBe('Base import CSV processing failed');
      const tables = (await getTableList(baseId)).data;
      const compiler = await manager.dataKnexForBase(baseId);
      const dataPrisma = await manager.dataPrismaForBase(baseId);
      for (const sourceTable of [first, later]) {
        const target = tables.find(({ id }) => id === imported!.tableIdMap[sourceTable.id])!;
        expect((await getRecords(target.id)).records).toHaveLength(0);
        expect(
          await dataPrisma.$queryRawUnsafe<{ count: number }[]>(
            compiler.raw('SELECT count(*)::int AS count FROM ??', [target.dbTableName]).toQuery()
          )
        ).toEqual([{ count: 0 }]);
      }
      await assertSafeImportFailureNotification(baseId, failed[0].failedReason, [
        constraintName,
        actorId,
        first.records[0].id,
        later.records[0].id,
        'Synthetic failing row',
        'Synthetic queued row',
      ]);
    } finally {
      await queue.resume();
    }
  }, 60_000);
});
