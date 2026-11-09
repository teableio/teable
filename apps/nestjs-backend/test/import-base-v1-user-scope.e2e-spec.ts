/* eslint-disable @typescript-eslint/naming-convention */
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import type {
  IAttachmentItem,
  IFieldRo,
  ILinkFieldOptionsRo,
  ILookupOptionsRo,
  IUserCellValue,
} from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  getRandomString,
  Relationship,
  Role,
  SortFunc,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson, INotifyVo, IUserMeVo } from '@teable/openapi';
import {
  CollaboratorType,
  createSpace as apiCreateSpace,
  deleteSpaceCollaborator,
  emailBaseInvitation,
  emailSpaceInvitation,
  exportBase,
  getFields,
  getTableList,
  PrincipalType,
  USER_ME,
} from '@teable/openapi';
import { domainError } from '@teable/v2-core';
import archiver from 'archiver';
import { stringify } from 'csv-stringify/sync';
import type { ClsStore } from 'nestjs-cls';
import { ClsService } from 'nestjs-cls';
import { err } from 'neverthrow';
import Papa from 'papaparse';
import * as unzipper from 'unzipper';
import { PostgresUserLookupService } from '../../../packages/v2/adapter-table-repository-postgres/src/record/repository/PostgresUserLookupService';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { AttachmentsService } from '../src/features/attachments/attachments.service';
import { BaseImportCsvQueueProcessor } from '../src/features/base/base-import-processor/base-import-csv.processor';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createAwaitWithEventWithResult } from './utils/event-promise';
import {
  createBase,
  createField,
  createTable,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  updateRecordByApi,
} from './utils/init-app';

const rowCount = 1002;
const chunkSize = 1000;
const password = '12345678';

type ArchiveRows = {
  columns: string[];
  rows: Array<Record<string, string>>;
  table: IBaseJson['tables'][number];
};

type ImportJob = {
  id: string;
  attemptsMade: number;
  failedReason?: string;
  getState(): Promise<string>;
  retry(): Promise<void>;
};

describe('public V1 .tea import user scope (e2e)', () => {
  const spaceId = globalThis.testConfig.spaceId;
  const actorId = globalThis.testConfig.userId;
  const actorName = globalThis.testConfig.userName;
  const actorEmail = globalThis.testConfig.email;
  const sourceName = `v1-user-scope-import-${Date.now()}`;
  const organizationId = `org${getRandomString(16)}`;
  const departmentId = `dpt${getRandomString(16)}`;
  const departmentCollaboratorId = getRandomString(16);
  const importedBaseIds = new Set<string>();

  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let prisma: PrismaService;
  let processor: BaseImportCsvQueueProcessor;
  let previousForceV2All: string | undefined;
  let sourceBaseId: string;
  let sourceSpaceId: string;
  let sourceArchive: Buffer;
  let spaceMember: IUserMeVo;
  let sourceOnlyMember: IUserMeVo;
  let targetBaseMember: IUserMeVo;
  let departmentMember: IUserMeVo;
  let scopedSystem: IUserMeVo;
  let spaceMemberEmail: string;
  let sourceOnlyEmail: string;
  let departmentMemberEmail: string;
  let scopedSystemEmail: string;
  // EE-only organization/department schema; absent on the community (OSS) e2e
  // database. The whole suite leans on department-scoped resolution, so when the
  // tables are missing the seed is skipped and every case skips (see beforeEach).
  let hasOrgTables = false;

  const userCell = (id: string, title: string, email: string): string =>
    JSON.stringify({
      id,
      title,
      email,
      avatarUrl: 'https://attacker.invalid/avatar.png',
    });

  const idOnlyUserCell = (id: string, title: string): string => JSON.stringify({ id, title });

  const requireNamed = <T extends { name: string }>(items: ReadonlyArray<T>, name: string): T => {
    const item = items.find((candidate) => candidate.name === name);
    expect(item, `Missing ${name}`).toBeDefined();
    if (!item) throw new Error(`Missing ${name}`);
    return item;
  };

  const repackTableCsv = async (
    teaBuffer: Buffer,
    patch: (archive: ArchiveRows) => void
  ): Promise<Buffer> => {
    const directory = await unzipper.Open.buffer(teaBuffer);
    const structureEntry = directory.files.find((file) => file.path === 'structure.json');
    if (!structureEntry) throw new Error('Exported .tea has no structure.json');
    const structure = JSON.parse((await structureEntry.buffer()).toString('utf8')) as IBaseJson;
    const table = structure.tables.find((candidate) => candidate.name === 'Scoped Users');
    if (!table) throw new Error('Exported .tea has no Scoped Users table');
    const tablePath = `tables/${table.id}.csv`;

    const archive = archiver('zip', { zlib: { level: 0 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const { promise: finished, resolve, reject } = Promise.withResolvers<void>();
    archive.on('end', resolve);
    archive.on('error', reject);

    for (const file of directory.files) {
      if (file.type !== 'File') continue;
      const content = await file.buffer();
      if (file.path !== tablePath) {
        archive.append(content, { name: file.path });
        continue;
      }

      const parsed = Papa.parse<Record<string, string>>(content.toString('utf8'), {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length) {
        throw new Error(`Could not parse exported table CSV: ${parsed.errors[0]?.message}`);
      }
      const columns = [...(parsed.meta.fields ?? [])];
      for (const systemColumn of ['__created_by', '__last_modified_by']) {
        if (!columns.includes(systemColumn)) columns.push(systemColumn);
      }
      patch({ columns, rows: parsed.data, table });
      archive.append(stringify(parsed.data, { header: true, columns }), { name: file.path });
    }

    await archive.finalize();
    await finished;
    return Buffer.concat(chunks);
  };

  const patchLegalIdentities = ({ rows, table }: ArchiveRows, includeTargetBaseMember = false) => {
    const actorField = requireNamed(table.fields, 'Actor');
    const spaceField = requireNamed(table.fields, 'Space Member');
    const baseField = requireNamed(table.fields, 'Base Member');
    const departmentField = requireNamed(table.fields, 'Department Member');
    const systemField = requireNamed(table.fields, 'Scoped System');
    const emptyField = requireNamed(table.fields, 'Empty User');
    const multipleField = requireNamed(table.fields, 'Multiple Users');
    const emptyMultipleField = requireNamed(table.fields, 'Empty Multiple Users');
    const lookupField = requireNamed(table.fields, 'Lookup Owners');

    for (const [index, row] of rows.entries()) {
      row[actorField.dbFieldName] = idOnlyUserCell(actorId, 'forged actor');
      row[spaceField.dbFieldName] = idOnlyUserCell(spaceMember.id, 'forged space member');
      row[baseField.dbFieldName] = includeTargetBaseMember
        ? idOnlyUserCell(targetBaseMember.id, 'forged base member')
        : idOnlyUserCell(actorId, 'forged actor as base member');
      row[departmentField.dbFieldName] = idOnlyUserCell(
        departmentMember.id,
        'forged department member'
      );
      row[systemField.dbFieldName] = idOnlyUserCell(scopedSystem.id, 'forged system member');
      row[emptyField.dbFieldName] = '';
      row[multipleField.dbFieldName] = JSON.stringify([
        { id: actorId, title: 'forged actor' },
        { id: spaceMember.id, title: 'forged member' },
      ]);
      row[emptyMultipleField.dbFieldName] = '[]';
      // A real persisted lookup(user) column is computed target metadata. Its archive snapshot is
      // untrusted and must be dropped, not collaborator-authorized or inserted.
      row[lookupField.dbFieldName] = userCell(
        sourceOnlyMember.id,
        'FORGED COMPUTED OUTSIDER',
        sourceOnlyEmail
      );
      // V1 discards archive attribution: creator is the importer, while the nullable modifier
      // column keeps its target-table default. A direct blank second row controls that a real,
      // distinct archive modifier on the other rows is discarded rather than merely unresolved.
      row.__created_by = sourceOnlyMember.id;
      row.__last_modified_by = index === 1 ? '' : sourceOnlyMember.id;
    }
  };

  const waitForJob = async (jobId: string): Promise<ImportJob> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const job = (await processor.queue.getJob(jobId)) as ImportJob | null;
      if (job) return job;
      await delay(25);
    }
    throw new Error(`Import queue job ${jobId} was not created`);
  };

  const waitForTerminalState = async (
    job: ImportJob
  ): Promise<{ state: 'completed' | 'failed'; failedReason?: string }> => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const state = await job.getState();
      if (state === 'completed' || state === 'failed') {
        const refreshed = (await processor.queue.getJob(job.id)) as ImportJob | null;
        return { state, failedReason: refreshed?.failedReason };
      }
      await delay(25);
    }
    throw new Error('Import queue job did not reach a terminal state');
  };

  const retryAndWaitForFailure = async (job: ImportJob): Promise<ImportJob> => {
    const previousAttempts = job.attemptsMade;
    await job.retry();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const refreshed = (await processor.queue.getJob(job.id)) as ImportJob | null;
      if (
        refreshed &&
        (await refreshed.getState()) === 'failed' &&
        refreshed.attemptsMade > previousAttempts
      ) {
        return refreshed;
      }
      await delay(25);
    }
    throw new Error('Retried import queue job did not fail again');
  };

  const importArchive = async (archiveBytes: Buffer) => {
    const notify = await app.get(ClsService).runWith<Promise<IAttachmentItem>>(
      {
        user: {
          id: actorId,
          name: actorName,
          email: actorEmail,
          isAdmin: null,
        },
      } as unknown as ClsStore,
      () =>
        app.get(AttachmentsService).uploadFromStream(Readable.from(archiveBytes), {
          filename: 'v1-user-scope.tea',
          contentType: 'application/zip',
          contentLength: archiveBytes.length,
        })
    );

    const response = await fetch(`${appUrl}/api/base/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'x-canary': 'false',
      },
      body: JSON.stringify({ notify: notify as unknown as INotifyVo, spaceId }),
    });
    const body = (await response.json()) as { base?: { id: string }; message?: string };
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(response.headers.get('x-teable-v2')).toBe('false');
    const importedBaseId = body.base?.id;
    expect(importedBaseId, 'Import response omitted base id').toBeDefined();
    if (!importedBaseId) throw new Error('Import response omitted base id');
    importedBaseIds.add(importedBaseId);

    const jobId = `import_csv_${notify.path}_${actorId}`;
    return { baseId: importedBaseId, job: await waitForJob(jobId) };
  };

  const assertNoRows = async (baseId: string) => {
    const importedTable = requireNamed((await getTableList(baseId)).data, 'Scoped Users');
    expect(
      (await getRecords(importedTable.id, { fieldKeyType: FieldKeyType.Id, take: 1 })).records
    ).toHaveLength(0);
  };

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'false';
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    cookie = appCtx.cookie;
    prisma = app.get(PrismaService);
    processor = app.get(BaseImportCsvQueueProcessor);

    const orgProbe = await prisma.$queryRaw<{ present: boolean }[]>`
      select to_regclass('organization') is not null as present
    `;
    hasOrgTables = Boolean(orgProbe[0]?.present);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    spaceMemberEmail = `v1-tea-space-${suffix}@example.com`;
    sourceOnlyEmail = `v1-tea-outsider-${suffix}@example.com`;
    const targetBaseMemberEmail = `v1-tea-base-${suffix}@example.com`;
    departmentMemberEmail = `v1-tea-department-${suffix}@example.com`;
    scopedSystemEmail = `v1-tea-system-${suffix}@example.com`;

    const users = await Promise.all(
      [
        spaceMemberEmail,
        sourceOnlyEmail,
        targetBaseMemberEmail,
        departmentMemberEmail,
        scopedSystemEmail,
      ].map((email) => createNewUserAxios({ email, password }))
    );
    [spaceMember, sourceOnlyMember, targetBaseMember, departmentMember, scopedSystem] =
      await Promise.all(
        users.map((axios) => axios.get<IUserMeVo>(USER_ME).then(({ data }) => data))
      );

    const canonicalNames = new Map([
      [spaceMember.id, 'Canonical Space Member'],
      [sourceOnlyMember.id, 'Canonical Source-Only Member'],
      [targetBaseMember.id, 'Canonical Base Member'],
      [departmentMember.id, 'Canonical Department Member'],
      [scopedSystem.id, 'Canonical Scoped System'],
    ]);
    await Promise.all(
      [...canonicalNames].map(([id, name]) => prisma.user.update({ where: { id }, data: { name } }))
    );
    spaceMember = { ...spaceMember, name: canonicalNames.get(spaceMember.id)! };
    sourceOnlyMember = { ...sourceOnlyMember, name: canonicalNames.get(sourceOnlyMember.id)! };
    targetBaseMember = { ...targetBaseMember, name: canonicalNames.get(targetBaseMember.id)! };
    departmentMember = { ...departmentMember, name: canonicalNames.get(departmentMember.id)! };
    scopedSystem = { ...scopedSystem, name: canonicalNames.get(scopedSystem.id)! };

    if (hasOrgTables) {
      await prisma.$executeRaw`
      insert into organization (id, name, created_by)
      values (${organizationId}, ${'V1 Tea Import Scope'}, ${actorId})
    `;
      await prisma.$executeRaw`
      insert into organization_space (id, organization_id, space_id)
      values (${getRandomString(16)}, ${organizationId}, ${spaceId})
    `;
      await prisma.$executeRaw`
      insert into organization_user (id, organization_id, user_id)
      values (${getRandomString(16)}, ${organizationId}, ${departmentMember.id})
    `;
      await prisma.$executeRaw`
      insert into organization_department (id, name, organization_id, path, created_by)
      values (
        ${departmentId},
        ${'V1 Import Scope Department'},
        ${organizationId},
        ${JSON.stringify([departmentId])}::jsonb,
        ${actorId}
      )
    `;
      await prisma.$executeRaw`
      insert into organization_user_department (id, user_id, department_id)
      values (${getRandomString(16)}, ${departmentMember.id}, ${departmentId})
    `;
      await prisma.collaborator.create({
        data: {
          id: departmentCollaboratorId,
          resourceId: spaceId,
          resourceType: CollaboratorType.Space,
          roleName: Role.Editor,
          principalId: departmentId,
          principalType: PrincipalType.Department,
          createdBy: actorId,
        },
      });
    }

    await emailSpaceInvitation({
      spaceId,
      emailSpaceInvitationRo: {
        emails: [spaceMemberEmail, scopedSystemEmail],
        role: Role.Editor,
      },
    });
    await prisma.user.update({ where: { id: scopedSystem.id }, data: { isSystem: true } });

    sourceSpaceId = (await apiCreateSpace({ name: `${sourceName}-space` })).data.id;
    expect(sourceSpaceId).not.toBe(spaceId);
    sourceBaseId = (await createBase({ name: sourceName, spaceId: sourceSpaceId })).id;
    await emailBaseInvitation({
      baseId: sourceBaseId,
      emailBaseInvitationRo: { emails: [sourceOnlyEmail], role: Role.Editor },
    });
    const lookupSource = await createTable(sourceBaseId, {
      name: 'Lookup Source',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Owner', type: FieldType.User },
      ],
      records: [
        {
          fields: {
            Name: 'lookup-source',
            Owner: { id: actorId, title: actorName, email: actorEmail },
          },
        },
      ],
    });
    const lookupOwnerField = requireNamed(lookupSource.fields, 'Owner');
    const scopedUsers = await createTable(sourceBaseId, {
      name: 'Scoped Users',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Actor', type: FieldType.User },
        { name: 'Space Member', type: FieldType.User },
        { name: 'Base Member', type: FieldType.User },
        { name: 'Department Member', type: FieldType.User },
        { name: 'Scoped System', type: FieldType.User },
        { name: 'Empty User', type: FieldType.User },
        {
          name: 'Multiple Users',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
        {
          name: 'Empty Multiple Users',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
        { name: 'Created By', type: FieldType.CreatedBy },
        { name: 'Last Modified By', type: FieldType.LastModifiedBy },
      ],
      records: Array.from({ length: rowCount }, (_, index) => ({
        fields: { Title: `row-${String(index).padStart(3, '0')}` },
      })),
    });
    const lookupLink = await createField(scopedUsers.id, {
      name: 'Lookup Link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: lookupSource.id,
      } as ILinkFieldOptionsRo,
    } as IFieldRo);
    await createField(scopedUsers.id, {
      name: 'Lookup Owners',
      type: FieldType.User,
      isLookup: true,
      lookupOptions: {
        foreignTableId: lookupSource.id,
        linkFieldId: lookupLink.id,
        lookupFieldId: lookupOwnerField.id,
      } as ILookupOptionsRo,
    } as IFieldRo);
    const scopedSourceRecord = scopedUsers.records[0];
    const lookupSourceRecord = lookupSource.records[0];
    expect(scopedSourceRecord, 'Missing scoped source record').toBeDefined();
    expect(lookupSourceRecord, 'Missing lookup source record').toBeDefined();
    if (!scopedSourceRecord || !lookupSourceRecord) throw new Error('Missing source record');
    await updateRecordByApi(scopedUsers.id, scopedSourceRecord.id, lookupLink.id, {
      id: lookupSourceRecord.id,
    });

    const awaitExport = createAwaitWithEventWithResult<{ previewUrl: string }>(
      app.get(EventEmitterService),
      Events.BASE_EXPORT_COMPLETE
    );
    const { previewUrl } = await awaitExport(() => exportBase(sourceBaseId));
    const response = await fetch(appUrl + previewUrl);
    expect(response.ok).toBe(true);
    sourceArchive = Buffer.from(await response.arrayBuffer());
  }, 60_000);

  // Every case resolves a department-scoped member, which only exists where the
  // EE organization tables do. Skip the whole suite on the community database.
  beforeEach((ctx) => {
    if (!hasOrgTables) ctx.skip();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const baseId of importedBaseIds) {
      await permanentDeleteBase(baseId).catch(() => undefined);
    }
    importedBaseIds.clear();
  });

  afterAll(async () => {
    if (sourceSpaceId) await permanentDeleteSpace(sourceSpaceId).catch(() => undefined);
    for (const principalId of [spaceMember?.id, scopedSystem?.id]) {
      if (!principalId) continue;
      await deleteSpaceCollaborator({
        spaceId,
        deleteSpaceCollaboratorRo: { principalId, principalType: PrincipalType.User },
      }).catch(() => undefined);
    }
    if (hasOrgTables) {
      await prisma?.collaborator.deleteMany({ where: { id: departmentCollaboratorId } });
      await prisma.$executeRaw`delete from organization where id = ${organizationId}`;
    }
    await app?.close();
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
  }, 30_000);

  it('routes the public endpoint to V1 and canonicalizes every legal destination collaborator once per chunk', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => patchLegalIdentities(data, true));
    const originalLookup = PostgresUserLookupService.prototype.listTableUsersByIdentifiers;
    const originalPairLookup = PostgresUserLookupService.prototype.listUsersByIdentityPairs;
    const originalAdd = processor.queue.add.bind(processor.queue);
    let lookupCount = 0;
    let grantPromise: Promise<void> | undefined;
    const collaboratorId = getRandomString(16);

    vi.spyOn(processor.queue, 'add').mockImplementation(
      async (...args: Parameters<typeof processor.queue.add>) => {
        const [name, data, options] = args;
        const actorField = data.structure.tables
          .flatMap((table) => table.fields)
          .find((field) => field.name === 'Actor');
        if (!actorField) throw new Error('Missing Actor field in queued import structure');
        actorField.type = FieldType.SingleLineText;
        return await originalAdd(name, data, options);
      }
    );
    vi.spyOn(PostgresUserLookupService.prototype, 'listTableUsersByIdentifiers').mockImplementation(
      async function (tableId, identifiers) {
        lookupCount += 1;
        grantPromise ??= (async () => {
          const table = await prisma.tableMeta.findUniqueOrThrow({
            where: { id: tableId },
            select: { baseId: true },
          });
          await prisma.collaborator.create({
            data: {
              id: collaboratorId,
              resourceId: table.baseId,
              resourceType: CollaboratorType.Base,
              roleName: Role.Editor,
              principalId: targetBaseMember.id,
              principalType: PrincipalType.User,
              createdBy: actorId,
            },
          });
        })();
        await grantPromise;
        return await originalLookup.call(this, tableId, identifiers);
      }
    );

    let pairLookupCount = 0;
    vi.spyOn(PostgresUserLookupService.prototype, 'listUsersByIdentityPairs').mockImplementation(
      async function (pairs) {
        pairLookupCount += 1;
        return originalPairLookup.call(this, pairs);
      }
    );
    try {
      const { baseId, job } = await importArchive(archive);
      expect((await waitForTerminalState(job)).state).toBe('completed');
      // The one-row exported source has a complete pair; editable id-only controls
      // remain one destination-scoped lookup per bounded Scoped Users chunk.
      expect(lookupCount).toBe(Math.ceil(rowCount / chunkSize));
      expect(pairLookupCount).toBe(1);

      const importedTable = requireNamed((await getTableList(baseId)).data, 'Scoped Users');
      const fields = (await getFields(importedTable.id)).data;
      const fieldByName = (name: string) => requireNamed(fields, name);
      const orderBy = [{ fieldId: fieldByName('Title').id, order: SortFunc.Asc }];
      const records = [
        ...(
          await getRecords(importedTable.id, {
            fieldKeyType: FieldKeyType.Id,
            take: chunkSize,
            orderBy,
          })
        ).records,
        ...(
          await getRecords(importedTable.id, {
            fieldKeyType: FieldKeyType.Id,
            skip: chunkSize,
            take: rowCount - chunkSize,
            orderBy,
          })
        ).records,
      ];
      expect(records).toHaveLength(rowCount);
      const firstRecord = records[0];
      const blankModifierControl = records[1];
      expect(firstRecord, 'Missing first imported record').toBeDefined();
      expect(blankModifierControl, 'Missing blank-modifier control record').toBeDefined();
      if (!firstRecord || !blankModifierControl) throw new Error('Missing imported control record');
      expect(firstRecord.fields[fieldByName('Actor').id]).toMatchObject({
        id: actorId,
        title: actorName,
        email: actorEmail,
      });
      expect(firstRecord.fields[fieldByName('Space Member').id]).toMatchObject({
        id: spaceMember.id,
        title: spaceMember.name,
        email: spaceMember.email,
      });
      expect(firstRecord.fields[fieldByName('Base Member').id]).toMatchObject({
        id: targetBaseMember.id,
        title: targetBaseMember.name,
        email: targetBaseMember.email,
      });
      expect(firstRecord.fields[fieldByName('Department Member').id]).toMatchObject({
        id: departmentMember.id,
        title: departmentMember.name,
        email: departmentMember.email,
      });
      expect(firstRecord.fields[fieldByName('Scoped System').id]).toMatchObject({
        id: scopedSystem.id,
        title: scopedSystem.name,
        email: scopedSystem.email,
      });
      expect(firstRecord.fields[fieldByName('Empty User').id]).toBeUndefined();
      expect(firstRecord.fields[fieldByName('Multiple Users').id]).toEqual([
        expect.objectContaining({ id: actorId, title: actorName, email: actorEmail }),
        expect.objectContaining({
          id: spaceMember.id,
          title: spaceMember.name,
          email: spaceMember.email,
        }),
      ]);
      expect(firstRecord.fields[fieldByName('Empty Multiple Users').id]).toEqual([]);
      expect(firstRecord.fields[fieldByName('Created By').id] as IUserCellValue).toMatchObject({
        id: actorId,
        title: actorName,
      });
      const lastModifiedByField = fieldByName('Last Modified By');
      expect(firstRecord.fields[lastModifiedByField.id]).toBeUndefined();
      expect(blankModifierControl.fields[lastModifiedByField.id]).toBeUndefined();

      const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
        where: { id: importedTable.id },
        select: { dbTableName: true },
      });
      const [schemaName, physicalTableName] = dbTableName.split('.');
      expect(schemaName, 'Imported table omitted its schema').toBeDefined();
      expect(physicalTableName, 'Imported table omitted its physical name').toBeDefined();
      if (!schemaName || !physicalTableName)
        throw new Error('Invalid imported physical table name');
      const rawModifiers = await prisma.$queryRawUnsafe<
        Array<{ __id: string; __last_modified_by: string | null }>
      >(
        `SELECT "__id", "__last_modified_by" FROM "${schemaName}"."${physicalTableName}" WHERE "__id" IN ($1, $2)`,
        firstRecord.id,
        blankModifierControl.id
      );
      const rawModifierByRecordId = new Map(
        rawModifiers.map((record) => [record.__id, record.__last_modified_by])
      );
      // The imported real modifier and the direct blank control both use the V1 target schema's
      // nullable, no-default __last_modified_by column; neither archive value reaches storage.
      expect(rawModifierByRecordId.get(firstRecord.id)).toBeNull();
      expect(rawModifierByRecordId.get(blankModifierControl.id)).toBeNull();
      const lookupValue = firstRecord.fields[fieldByName('Lookup Owners').id];
      expect(lookupValue).toMatchObject({ id: actorId, title: actorName, email: actorEmail });
      expect(JSON.stringify(lookupValue)).not.toContain(sourceOnlyMember.id);
      expect(JSON.stringify(lookupValue)).not.toContain(sourceOnlyEmail);
      expect(JSON.stringify(lookupValue)).not.toContain('FORGED COMPUTED OUTSIDER');
      expect(JSON.stringify(firstRecord.fields)).not.toContain('forged');
      expect(JSON.stringify(firstRecord.fields)).not.toContain(sourceOnlyMember.id);
      expect(JSON.stringify(firstRecord.fields)).not.toContain(sourceOnlyEmail);
    } finally {
      await prisma.collaborator.deleteMany({ where: { id: collaboratorId } });
    }
  }, 30_000);

  it('accepts a source-only member with an exact id/email pair and canonicalizes the profile', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchLegalIdentities(data);
      const actorField = requireNamed(data.table.fields, 'Actor');
      const firstRow = data.rows[0];
      expect(firstRow, 'Missing first archive row').toBeDefined();
      if (!firstRow) throw new Error('Missing first archive row');
      firstRow[actorField.dbFieldName] = userCell(
        sourceOnlyMember.id,
        'FORGED EXACT-PAIR PROFILE',
        sourceOnlyEmail
      );
      const multipleField = requireNamed(data.table.fields, 'Multiple Users');
      firstRow[multipleField.dbFieldName] = JSON.stringify([
        { id: actorId },
        { id: sourceOnlyMember.id, email: sourceOnlyEmail, title: 'FORGED MULTIPLE PAIR' },
      ]);
    });

    const { baseId, job } = await importArchive(archive);
    expect((await waitForTerminalState(job)).state).toBe('completed');
    const [sourceBaseMeta, importedBaseMeta, targetBases, sourceMembership] = await Promise.all([
      prisma.base.findUniqueOrThrow({ where: { id: sourceBaseId }, select: { spaceId: true } }),
      prisma.base.findUniqueOrThrow({ where: { id: baseId }, select: { spaceId: true } }),
      prisma.base.findMany({ where: { spaceId }, select: { id: true } }),
      prisma.collaborator.findFirstOrThrow({
        where: {
          principalId: sourceOnlyMember.id,
          principalType: PrincipalType.User,
          resourceId: sourceBaseId,
          resourceType: CollaboratorType.Base,
        },
        select: { resourceId: true },
      }),
    ]);
    expect(sourceBaseMeta.spaceId).toBe(sourceSpaceId);
    expect(importedBaseMeta.spaceId).toBe(spaceId);
    expect(sourceBaseMeta.spaceId).not.toBe(importedBaseMeta.spaceId);
    expect(sourceMembership.resourceId).toBe(sourceBaseId);
    const targetMemberships = await prisma.collaborator.findMany({
      where: {
        principalId: sourceOnlyMember.id,
        principalType: PrincipalType.User,
        OR: [
          { resourceType: CollaboratorType.Space, resourceId: spaceId },
          {
            resourceType: CollaboratorType.Base,
            resourceId: { in: targetBases.map(({ id }) => id) },
          },
        ],
      },
      select: { id: true },
    });
    expect(targetMemberships).toEqual([]);

    const importedTable = requireNamed((await getTableList(baseId)).data, 'Scoped Users');
    const fields = (await getFields(importedTable.id)).data;
    const fieldByName = (name: string) => requireNamed(fields, name);
    const records = await getRecords(importedTable.id, {
      fieldKeyType: FieldKeyType.Id,
      take: 1,
      orderBy: [{ fieldId: fieldByName('Title').id, order: SortFunc.Asc }],
    });
    const firstRecord = records.records[0];
    expect(firstRecord, 'Missing first imported record').toBeDefined();
    if (!firstRecord) throw new Error('Missing first imported record');

    const actorValue = firstRecord.fields[fieldByName('Actor').id];
    expect(actorValue).toMatchObject({
      id: sourceOnlyMember.id,
      title: sourceOnlyMember.name,
      email: sourceOnlyEmail,
    });
    expect(firstRecord.fields[fieldByName('Multiple Users').id]).toEqual([
      expect.objectContaining({ id: actorId, title: actorName, email: actorEmail }),
      expect.objectContaining({
        id: sourceOnlyMember.id,
        title: sourceOnlyMember.name,
        email: sourceOnlyEmail,
      }),
    ]);
    expect(JSON.stringify(actorValue)).not.toContain('FORGED EXACT-PAIR PROFILE');
    expect(JSON.stringify(actorValue)).not.toContain('attacker.invalid');
    expect(firstRecord.fields[fieldByName('Created By').id] as IUserCellValue).toMatchObject({
      id: actorId,
      title: actorName,
    });
  }, 30_000);

  it('rejects a destination-scoped id paired with another profile email without exposing a profile', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchLegalIdentities(data);
      const actorField = requireNamed(data.table.fields, 'Actor');
      const firstRow = data.rows[0];
      expect(firstRow, 'Missing first archive row').toBeDefined();
      if (!firstRow) throw new Error('Missing first archive row');
      firstRow[actorField.dbFieldName] = userCell(
        actorId,
        'FORGED SCOPED MISMATCH',
        sourceOnlyEmail
      );
    });

    const { baseId, job } = await importArchive(archive);
    const terminal = await waitForTerminalState(job);
    expect(terminal.state).toBe('failed');
    expect(terminal.failedReason).toContain('validation.field.user_not_found');
    for (const profileValue of [
      actorId,
      actorName,
      actorEmail,
      sourceOnlyMember.id,
      sourceOnlyMember.name,
      sourceOnlyEmail,
      'FORGED SCOPED MISMATCH',
    ]) {
      expect(terminal.failedReason).not.toContain(profileValue);
    }
    await assertNoRows(baseId);
  }, 30_000);

  it('does not let an id-only cell borrow an exact pair for the same user elsewhere in its chunk', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchLegalIdentities(data);
      const actorField = requireNamed(data.table.fields, 'Actor');
      const idOnlyRow = data.rows[0];
      const exactPairRow = data.rows[1];
      expect(idOnlyRow, 'Missing id-only archive row').toBeDefined();
      expect(exactPairRow, 'Missing exact-pair archive row').toBeDefined();
      if (!idOnlyRow || !exactPairRow) throw new Error('Missing archive row');
      idOnlyRow[actorField.dbFieldName] = idOnlyUserCell(
        sourceOnlyMember.id,
        'FORBIDDEN ID-ONLY PROFILE'
      );
      exactPairRow[actorField.dbFieldName] = userCell(
        sourceOnlyMember.id,
        'FORGED EXACT-PAIR PROFILE',
        sourceOnlyEmail
      );
    });

    const { baseId, job } = await importArchive(archive);
    const terminal = await waitForTerminalState(job);
    expect(terminal.state).toBe('failed');
    expect(terminal.failedReason).toContain('validation.field.user_not_found');
    expect(terminal.failedReason).not.toContain(sourceOnlyMember.id);
    expect(terminal.failedReason).not.toContain(sourceOnlyMember.name);
    expect(terminal.failedReason).not.toContain(sourceOnlyEmail);
    expect(terminal.failedReason).not.toContain('FORBIDDEN ID-ONLY PROFILE');
    expect(terminal.failedReason).not.toContain('FORGED EXACT-PAIR PROFILE');
    await assertNoRows(baseId);
  }, 30_000);

  it.each([
    [
      'mixed legal and source-base-only outsider chunk',
      () => sourceOnlyMember.id,
      () => sourceOnlyEmail,
      true,
      1,
    ],
    ['unknown user', () => 'usrUnknownV1TeaImport', () => 'unknown-v1-tea@example.com', false, 0],
  ])(
    'fails the queue and restores no rows for a %s',
    async (_label, getId, getEmail, useIdOnlySnapshot, targetRowIndex) => {
      const archive = await repackTableCsv(sourceArchive, (data) => {
        patchLegalIdentities(data);
        const actorField = requireNamed(data.table.fields, 'Actor');
        const firstRow = data.rows[0];
        const targetRow = data.rows[targetRowIndex];
        expect(firstRow, 'Missing first archive row').toBeDefined();
        expect(targetRow, 'Missing target archive row').toBeDefined();
        if (!firstRow || !targetRow) throw new Error('Missing archive row');
        if (targetRowIndex > 0) expect(firstRow[actorField.dbFieldName]).toContain(actorId);
        targetRow[actorField.dbFieldName] = useIdOnlySnapshot
          ? idOnlyUserCell(getId(), 'FORBIDDEN ARCHIVE IDENTITY')
          : userCell(getId(), 'FORBIDDEN ARCHIVE IDENTITY', getEmail());
      });

      const { baseId, job } = await importArchive(archive);
      const terminal = await waitForTerminalState(job);
      expect(terminal.state).toBe('failed');
      expect(terminal.failedReason).toContain('validation.field.user_not_found');
      expect(terminal.failedReason).not.toContain(getId());
      expect(terminal.failedReason).not.toContain(getEmail());
      expect(terminal.failedReason).not.toContain('FORBIDDEN ARCHIVE IDENTITY');
      if (_label === 'mixed legal and source-base-only outsider chunk') {
        const failedJob = (await processor.queue.getJob(job.id)) as ImportJob;
        const retried = await retryAndWaitForFailure(failedJob);
        expect(['validation.field.user_not_found', 'Base import CSV processing failed']).toContain(
          retried.failedReason
        );
        expect(retried.failedReason).not.toContain(getId());
        expect(retried.failedReason).not.toContain(getEmail());
      }
      await assertNoRows(baseId);
    },
    30_000
  );

  it('fails the whole chunk when one multiple-user cell mixes a legal user and outsider', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchLegalIdentities(data);
      const multipleField = requireNamed(data.table.fields, 'Multiple Users');
      const firstRow = data.rows[0];
      expect(firstRow, 'Missing first archive row').toBeDefined();
      if (!firstRow) throw new Error('Missing first archive row');
      firstRow[multipleField.dbFieldName] = JSON.stringify([
        { id: actorId, title: actorName, email: actorEmail },
        {
          id: sourceOnlyMember.id,
          title: 'FORBIDDEN MULTIPLE USER',
        },
      ]);
    });

    const { baseId, job } = await importArchive(archive);
    const terminal = await waitForTerminalState(job);
    expect(terminal.state).toBe('failed');
    expect(terminal.failedReason).toBe('validation.field.user_not_found');
    expect(terminal.failedReason).not.toContain(sourceOnlyMember.id);
    expect(terminal.failedReason).not.toContain(sourceOnlyEmail);
    expect(terminal.failedReason).not.toContain('FORBIDDEN MULTIPLE USER');
    await assertNoRows(baseId);
  }, 30_000);

  it.each([
    [
      'array value in a single user field',
      'Actor',
      () => JSON.stringify([{ id: actorId, title: actorName, email: actorEmail }]),
    ],
    [
      'object value in a multiple user field',
      'Multiple Users',
      () => userCell(actorId, actorName, actorEmail),
    ],
    ['invalid JSON', 'Actor', () => '{invalid-json'],
    [
      'user object without an id',
      'Actor',
      () => JSON.stringify({ title: 'MISSING ID', email: 'missing-id@example.com' }),
    ],
  ])(
    'fails the whole chunk for %s',
    async (_label, fieldName, invalidValue) => {
      const archive = await repackTableCsv(sourceArchive, (data) => {
        patchLegalIdentities(data);
        const field = requireNamed(data.table.fields, fieldName);
        const firstRow = data.rows[0];
        expect(firstRow, 'Missing first archive row').toBeDefined();
        if (!firstRow) throw new Error('Missing first archive row');
        firstRow[field.dbFieldName] = invalidValue();
      });

      const { baseId, job } = await importArchive(archive);
      const terminal = await waitForTerminalState(job);
      expect(terminal.state).toBe('failed');
      expect(terminal.failedReason).toBe('validation.field.invalid_user_format');
      expect(terminal.failedReason).not.toContain('MISSING ID');
      expect(terminal.failedReason).not.toContain('missing-id@example.com');
      await assertNoRows(baseId);
    },
    30_000
  );

  it('keeps the first committed chunk but rejects an outsider in the next chunk', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchLegalIdentities(data);
      const actorField = requireNamed(data.table.fields, 'Actor');
      const lateRow = data.rows[chunkSize];
      expect(lateRow, 'Missing late archive row').toBeDefined();
      if (!lateRow) throw new Error('Missing late archive row');
      lateRow[actorField.dbFieldName] = idOnlyUserCell(
        sourceOnlyMember.id,
        'LATE FORBIDDEN ARCHIVE IDENTITY'
      );
    });

    const { baseId, job } = await importArchive(archive);
    const terminal = await waitForTerminalState(job);
    expect(terminal.state).toBe('failed');
    expect(terminal.failedReason).toContain('validation.field.user_not_found');

    const importedTable = requireNamed((await getTableList(baseId)).data, 'Scoped Users');
    const firstChunk = await getRecords(importedTable.id, {
      fieldKeyType: FieldKeyType.Id,
      take: chunkSize,
    });
    const afterFirstChunk = await getRecords(importedTable.id, {
      fieldKeyType: FieldKeyType.Id,
      skip: chunkSize,
      take: 1,
    });
    expect(firstChunk.records).toHaveLength(chunkSize);
    expect(afterFirstChunk.records).toHaveLength(0);
    expect(JSON.stringify(firstChunk.records)).not.toContain(sourceOnlyMember.id);
    expect(JSON.stringify(firstChunk.records)).not.toContain(sourceOnlyEmail);
  }, 30_000);

  it('fails closed and restores no rows when the destination collaborator lookup returns Err', async () => {
    const archive = await repackTableCsv(sourceArchive, patchLegalIdentities);
    const originalLookup = PostgresUserLookupService.prototype.listTableUsersByIdentifiers;
    vi.spyOn(PostgresUserLookupService.prototype, 'listTableUsersByIdentifiers').mockImplementation(
      async function (tableId, identifiers) {
        const table = await prisma.tableMeta.findUniqueOrThrow({
          where: { id: tableId },
          select: { name: true },
        });
        return table.name === 'Scoped Users'
          ? err(domainError.infrastructure({ message: 'Injected destination lookup failure' }))
          : await originalLookup.call(this, tableId, identifiers);
      }
    );

    const { baseId, job } = await importArchive(archive);
    const terminal = await waitForTerminalState(job);
    expect(terminal.state).toBe('failed');
    expect(terminal.failedReason).toContain('Failed to validate imported user references');
    expect(terminal.failedReason).not.toContain(actorId);
    expect(terminal.failedReason).not.toContain(actorEmail);
    await assertNoRows(baseId);
  }, 30_000);

  it('fails closed when the complete pair lookup fails without exposing profiles', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchLegalIdentities(data);
      const actorField = requireNamed(data.table.fields, 'Actor');
      data.rows[0]![actorField.dbFieldName] = userCell(
        sourceOnlyMember.id,
        'FORGED PAIR LOOKUP',
        sourceOnlyEmail
      );
    });
    const originalLookup = PostgresUserLookupService.prototype.listUsersByIdentityPairs;
    vi.spyOn(PostgresUserLookupService.prototype, 'listUsersByIdentityPairs').mockImplementation(
      async function (pairs) {
        return pairs.some((pair) => pair.id === sourceOnlyMember.id)
          ? err(domainError.infrastructure({ message: 'PRIVATE PAIR LOOKUP DETAILS' }))
          : originalLookup.call(this, pairs);
      }
    );
    const { baseId, job } = await importArchive(archive);
    const terminal = await waitForTerminalState(job);
    expect(terminal.state).toBe('failed');
    expect(terminal.failedReason).toBe('Failed to validate imported user references');
    expect(terminal.failedReason).not.toContain(sourceOnlyMember.id);
    expect(terminal.failedReason).not.toContain(sourceOnlyEmail);
    await assertNoRows(baseId);
  }, 30_000);
});
