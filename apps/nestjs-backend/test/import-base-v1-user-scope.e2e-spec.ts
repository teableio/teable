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
  NotificationSeverityEnum,
  NotificationTypeEnum,
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
import { ComputedFieldBackfillService } from '../../../packages/v2/adapter-table-repository-postgres/src/record/computed/ComputedFieldBackfillService';
import { ComputedUpdatePlanner } from '../../../packages/v2/adapter-table-repository-postgres/src/record/computed/ComputedUpdatePlanner';
import { ComputedTableRecordQueryBuilder } from '../../../packages/v2/adapter-table-repository-postgres/src/record/query-builder/computed/ComputedTableRecordQueryBuilder';
import { PostgresUserLookupService } from '../../../packages/v2/adapter-table-repository-postgres/src/record/repository/PostgresUserLookupService';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { AttachmentsService } from '../src/features/attachments/attachments.service';
import { BaseImportComputedService } from '../src/features/base/base-import-computed.service';
import { BaseImportCsvQueueProcessor } from '../src/features/base/base-import-processor/base-import-csv.processor';
import { BaseImportJunctionCsvQueueProcessor } from '../src/features/base/base-import-processor/base-import-junction.processor';
import { BatchProcessor } from '../src/features/base/BatchProcessor.class';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { DataDbClientManager } from '../src/global/data-db-client-manager.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createAwaitWithEventWithResult } from './utils/event-promise';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  getRecord,
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
  failedReason?: string;
  progress?: unknown;
  getState(): Promise<string>;
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
  let junctionProcessor: BaseImportJunctionCsvQueueProcessor;
  let archiveRecordIds: string[] = [];
  let previousForceV2All: string | undefined;
  let sourceBaseId: string;
  let sourceSpaceId: string;
  let sourceArchive: Buffer;
  let linkedSourceRecordId: string;
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
      archiveRecordIds = parsed.data.map((row) => row.__id!);
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
      // Department membership is EE-only; on the community database (no organization
      // tables) leave the cell empty so the rest of the V1 user-scope canonicalization
      // still runs and stays covered. See the gated assertion below.
      row[departmentField.dbFieldName] = hasOrgTables
        ? idOnlyUserCell(departmentMember.id, 'forged department member')
        : '';
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
    job: ImportJob,
    diagnostics?: () => Record<string, string | number>
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
    const refreshed = (await processor.queue.getJob(job.id)) as ImportJob | null;
    const savedProgress = refreshed?.progress;
    const progressDetails =
      typeof savedProgress === 'object' && savedProgress !== null ? savedProgress : undefined;
    const savedStage = progressDetails ? Reflect.get(progressDetails, 'stage') : undefined;
    const savedPercentage = progressDetails
      ? Reflect.get(progressDetails, 'percentage')
      : undefined;
    // Only stage labels and numeric progress are diagnostic data; never dump the job payload.
    const stage = [
      'queued',
      'download',
      'parse',
      'chunk',
      'recompute',
      'completed',
      'failed',
    ].includes(savedStage)
      ? savedStage
      : null;
    throw new Error(
      `Import queue job did not reach a terminal state: ${JSON.stringify({
        state: await (refreshed ?? job).getState(),
        progress:
          typeof savedProgress === 'number'
            ? savedProgress
            : typeof savedPercentage === 'number'
              ? savedPercentage
              : null,
        stage,
        failedReason: refreshed?.failedReason ?? null,
        diagnostics: diagnostics?.(),
      })}`
    );
  };

  const waitForImportedData = async (
    job: ImportJob,
    diagnostics?: () => Record<string, string | number>
  ) => {
    expect((await waitForTerminalState(job, diagnostics)).state).toBe('completed');
    const junctionJobId = job.id.replace(/^import_csv_/, 'import_base_junction_csv_');
    const deadline = Date.now() + 20_000;
    let lastState = 'missing';
    while (Date.now() < deadline) {
      const junctionJob = await junctionProcessor.queue.getJob(junctionJobId);
      if (junctionJob) {
        const state = await junctionJob.getState();
        lastState = state;
        if (state === 'completed' || state === 'failed') {
          expect(state, junctionJob.failedReason).toBe('completed');
          return;
        }
      }
      await delay(25);
    }
    throw new Error(
      `Import relationship queue did not complete its computed backfill: ${JSON.stringify({
        state: lastState,
        diagnostics: diagnostics?.(),
      })}`
    );
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

  const assertImportWarning = async (
    baseId: string,
    skippedUserCells: number,
    forbiddenValues: string[]
  ) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const notifications = await prisma.notification.findMany({
        where: {
          toUserId: actorId,
          type: NotificationTypeEnum.System,
          severity: NotificationSeverityEnum.Warning,
          urlPath: `/base/${baseId}`,
        },
      });
      const notification = notifications.find((item) => {
        const message = JSON.parse(item.messageI18n ?? '{}');
        return message.context?.skippedUserCells > 0;
      });
      if (notification) {
        expect(JSON.parse(notification.messageI18n!)).toEqual({
          i18nKey: 'notification.baseImport.skippedCells',
          context: { skippedUserCells, skippedLinkCells: 0 },
        });
        const message = `${notification.message ?? ''} ${notification.messageI18n ?? ''}`;
        for (const value of forbiddenValues) expect(message).not.toContain(value);
        expect(message).not.toContain('attacker.invalid');
        return;
      }
      await delay(50);
    }
    throw new Error('Missing import user-cell warning notification');
  };

  const assertImportFailureNotification = async (baseId: string, forbiddenValues: string[]) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const notifications = await prisma.notification.findMany({
        where: {
          toUserId: actorId,
          type: NotificationTypeEnum.System,
          severity: NotificationSeverityEnum.Warning,
          urlPath: `/base/${baseId}`,
        },
      });
      const notification = notifications.find(
        (item) => JSON.parse(item.messageI18n ?? '{}').i18nKey === 'notification.baseImport.failed'
      );
      if (notification) {
        expect(JSON.parse(notification.messageI18n!)).toEqual({
          i18nKey: 'notification.baseImport.failed',
        });
        const message = `${notification.message ?? ''} ${notification.messageI18n ?? ''}`;
        for (const value of forbiddenValues) expect(message).not.toContain(value);
        expect(message).not.toContain('attacker.invalid');
        return;
      }
      await delay(50);
    }
    throw new Error('Missing safe import failure notification');
  };

  const assertSkippedUserCell = async (
    baseId: string,
    rowIndex: number,
    fieldName: string,
    forbiddenValues: string[],
    expectedUsers: IUserCellValue[] = []
  ) => {
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
    expect(records.map((record) => record.fields[fieldByName('Title').id])).toEqual(
      Array.from({ length: rowCount }, (_, index) => `row-${String(index).padStart(3, '0')}`).sort()
    );
    const recordsById = new Map(records.map((record) => [record.id, record]));
    expect(recordsById.size).toBe(rowCount);
    expect([...recordsById.keys()].sort()).toEqual([...archiveRecordIds].sort());
    const skippedRecord = recordsById.get(archiveRecordIds[rowIndex]!);
    expect(skippedRecord, 'Missing the patched archive record').toBeDefined();
    if (!skippedRecord) throw new Error('Missing the patched archive record');
    const skippedValue = skippedRecord.fields[fieldByName(fieldName).id];
    if (fieldName === 'Multiple Users') {
      expect(skippedValue ?? []).toEqual(expectedUsers);
    } else {
      expect(skippedValue ?? null).toBeNull();
    }
    expect(
      await prisma.collaborator.count({
        where: {
          resourceId: { in: [spaceId, baseId] },
          principalId: sourceOnlyMember.id,
          principalType: PrincipalType.User,
        },
      })
    ).toBe(0);
    expect(recordsById.get(archiveRecordIds[2]!)!.fields[fieldByName('Actor').id]).toMatchObject({
      id: actorId,
      title: actorName,
      email: actorEmail,
    });
    for (const record of records) {
      expect(record.fields[fieldByName('Space Member').id]).toMatchObject({
        id: spaceMember.id,
        title: spaceMember.name,
        email: spaceMember.email,
      });
      expect(record.fields[fieldByName('Created By').id]).toMatchObject({
        id: actorId,
        title: actorName,
      });
      expect(record.fields[fieldByName('Last Modified By').id] ?? null).toBeNull();
    }
    expect(
      recordsById.get(linkedSourceRecordId)!.fields[fieldByName('Lookup Owners').id]
    ).toMatchObject({
      id: actorId,
      title: actorName,
      email: actorEmail,
    });
    expect(JSON.stringify(records)).not.toContain('FORGED');
    expect(JSON.stringify(records)).not.toContain('forged');
    expect(JSON.stringify(records)).not.toContain('FORBIDDEN');
    expect(JSON.stringify(records)).not.toContain('attacker.invalid');
    await assertImportWarning(baseId, 1, forbiddenValues);
    return { recordsById, fieldByName };
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
    junctionProcessor = app.get(BaseImportJunctionCsvQueueProcessor);

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
    linkedSourceRecordId = scopedSourceRecord.id;
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

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const baseId of importedBaseIds) {
      await prisma.notification.deleteMany({
        where: { toUserId: actorId, urlPath: `/base/${baseId}` },
      });
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

  const assertRequiredUserRelaxationWarning = async (baseId: string) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const notifications = await prisma.notification.findMany({
        where: {
          toUserId: actorId,
          type: NotificationTypeEnum.System,
          severity: NotificationSeverityEnum.Warning,
          urlPath: `/base/${baseId}`,
        },
      });
      const messages = notifications.map(({ messageI18n }) => JSON.parse(messageI18n ?? '{}'));
      const warning = messages.find(
        ({ i18nKey }) => i18nKey === 'notification.baseImport.relaxedRequiredUserFields'
      );
      if (warning) {
        expect(warning).toEqual({
          i18nKey: 'notification.baseImport.relaxedRequiredUserFields',
          context: { count: 1 },
        });
        return;
      }
      await delay(25);
    }
    throw new Error('Missing required User constraint relaxation warning');
  };

  const createRequiredUserArchive = async (
    titles: readonly string[] = ['First', 'Second'],
    isMultiple = false
  ) => {
    const previousForce = process.env.FORCE_V2_ALL;
    try {
      process.env.FORCE_V2_ALL = 'true';
      const source = await createBase({ name: 'Required user source', spaceId });
      importedBaseIds.add(source.id);
      const table = await createTable(source.id, {
        name: 'Scoped Users',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        records: [],
      });
      const affected = await createField(table.id, {
        name: 'Required Actor',
        type: FieldType.User,
        notNull: true,
        options: { isMultiple },
      });
      const control = await createField(table.id, {
        name: 'Required Control',
        type: FieldType.User,
        notNull: true,
      });
      for (let index = 0; index < titles.length; index += 100) {
        await createRecords(table.id, {
          fieldKeyType: FieldKeyType.Id,
          records: titles.slice(index, index + 100).map((title) => ({
            fields: {
              [table.fields[0].id]: title,
              [affected.id]: isMultiple ? [{ id: actorId }] : { id: actorId },
              [control.id]: { id: actorId },
            },
          })),
        });
      }
      const sourceFields = (await getFields(table.id)).data;
      expect(sourceFields.find(({ id }) => id === affected.id)?.notNull).toBe(true);
      expect(sourceFields.find(({ id }) => id === control.id)?.notNull).toBe(true);
      const awaitExport = createAwaitWithEventWithResult<{ previewUrl: string }>(
        app.get(EventEmitterService),
        Events.BASE_EXPORT_COMPLETE
      );
      const { previewUrl } = await awaitExport(() => exportBase(source.id, { includeData: true }));
      const response = await fetch(appUrl + previewUrl);
      expect(response.ok).toBe(true);
      return { sourceId: source.id, archive: Buffer.from(await response.arrayBuffer()) };
    } finally {
      if (previousForce == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForce;
    }
  };

  const assertCommittedRequiredUserBatch = async (baseId: string, committedIds: string[]) => {
    const table = (await getTableList(baseId)).data.find(({ name }) => name === 'Scoped Users')!;
    const fields = (await getFields(table.id)).data;
    const affected = fields.find(({ name }) => name === 'Required Actor')!;
    const control = fields.find(({ name }) => name === 'Required Control')!;
    expect(affected.notNull ?? false).toBe(false);
    expect(control.notNull).toBe(true);
    const records = (
      await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        take: committedIds.length,
      })
    ).records;
    expect(records).toHaveLength(committedIds.length);
    expect(records.map(({ id }) => id).sort()).toEqual([...committedIds].sort());
    expect(
      records.find(({ id }) => id === committedIds[0])?.fields[affected.id] ?? null
    ).toBeNull();
    for (const record of records) {
      expect(record.fields[control.id]).toMatchObject({
        id: actorId,
        title: actorName,
        email: actorEmail,
      });
      if (record.id !== committedIds[0]) {
        expect(record.fields[affected.id]).toMatchObject({
          id: actorId,
          title: actorName,
          email: actorEmail,
        });
      }
    }
    const manager = app.get(DataDbClientManager);
    const compiler = await manager.dataKnexForBase(baseId);
    const dataPrisma = await manager.dataPrismaForBase(baseId);
    const [schema, dbTable] = table.dbTableName.split('.');
    const sql = compiler('information_schema.columns')
      .select('column_name', 'is_nullable')
      .where({ table_schema: schema, table_name: dbTable })
      .whereIn('column_name', [affected.dbFieldName, control.dbFieldName])
      .toQuery();
    const columns =
      await dataPrisma.$queryRawUnsafe<{ column_name: string; is_nullable: string }[]>(sql);
    expect(columns).toHaveLength(2);
    expect(
      columns.find(({ column_name }) => column_name === affected.dbFieldName)?.is_nullable
    ).toBe('YES');
    expect(
      columns.find(({ column_name }) => column_name === control.dbFieldName)?.is_nullable
    ).toBe('NO');
    const countSql = compiler
      .raw('SELECT count(*)::int AS count FROM ??', [table.dbTableName])
      .toQuery();
    expect(await dataPrisma.$queryRawUnsafe<{ count: number }[]>(countSql)).toEqual([
      { count: committedIds.length },
    ]);
  };

  it('reports required User relaxation even when a later malformed batch fails closed', async () => {
    // BatchProcessor awaits each 1000-row handler before accepting the next chunk.
    const boundary = BatchProcessor.BATCH_SIZE;
    const { sourceId, archive: requiredArchive } = await createRequiredUserArchive(
      Array.from({ length: boundary + 1 }, (_, index) => `Required row ${index}`)
    );
    const unknownId = 'usr0000000000000000';
    const unknownEmail = 'required-user-absent@example.invalid';
    expect(await prisma.user.findUnique({ where: { id: unknownId } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: unknownEmail } })).toBeNull();
    const recordIds: string[] = [];
    const archive = await repackTableCsv(requiredArchive, ({ rows, table }) => {
      const affected = table.fields.find(({ name }) => name === 'Required Actor')!;
      const control = table.fields.find(({ name }) => name === 'Required Control')!;
      expect(affected.notNull).toBe(true);
      expect(control.notNull).toBe(true);
      expect(rows).toHaveLength(boundary + 1);
      recordIds.push(...rows.map(({ __id }) => __id));
      rows[0][affected.dbFieldName] = userCell(unknownId, 'UNKNOWN REQUIRED USER', unknownEmail);
      rows[boundary][control.dbFieldName] = JSON.stringify({
        id: 17,
        title: 'LATE MALFORMED REQUIRED USER',
      });
    });
    const { baseId, job } = await importArchive(archive);
    expect(baseId).not.toBe(sourceId);
    const terminal = await waitForTerminalState(job);
    expect(terminal).toEqual({
      state: 'failed',
      failedReason: 'validation.field.invalid_user_format',
    });
    const forbiddenValues = [unknownId, unknownEmail, 'LATE MALFORMED REQUIRED USER'];
    for (const value of forbiddenValues) expect(terminal.failedReason).not.toContain(value);
    await assertImportFailureNotification(baseId, [...forbiddenValues, actorId, actorEmail]);
    await assertCommittedRequiredUserBatch(baseId, recordIds.slice(0, boundary));
    expect(await prisma.user.findUnique({ where: { id: unknownId } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: unknownEmail } })).toBeNull();
    expect(
      await prisma.collaborator.count({
        where: { resourceId: baseId, principalId: unknownId, principalType: PrincipalType.User },
      })
    ).toBe(0);
    await assertRequiredUserRelaxationWarning(baseId);
  }, 60_000);

  it('relaxes only an affected required User field while retaining records and legal required constraints', async () => {
    const { sourceId: requiredSourceId, archive: requiredArchive } =
      await createRequiredUserArchive();
    const unknownId = 'usr0000000000000000';
    const unknownEmail = 'required-user-absent@example.invalid';
    expect(await prisma.user.findUnique({ where: { id: unknownId } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: unknownEmail } })).toBeNull();
    const preservedIds: string[] = [];
    const archive = await repackTableCsv(requiredArchive, ({ rows, table }) => {
      const affected = table.fields.find(({ name }) => name === 'Required Actor')!;
      const control = table.fields.find(({ name }) => name === 'Required Control')!;
      expect(affected.notNull).toBe(true);
      expect(control.notNull).toBe(true);
      expect(rows).toHaveLength(2);
      preservedIds.push(...rows.map(({ __id }) => __id));
      for (const row of rows) {
        row[affected.dbFieldName] = JSON.stringify({ id: actorId, title: 'forged actor' });
        row[control.dbFieldName] = JSON.stringify({ id: actorId, title: 'forged control' });
      }
      rows[0][affected.dbFieldName] = userCell(unknownId, 'UNKNOWN REQUIRED USER', unknownEmail);
    });
    const { baseId, job } = await importArchive(archive);
    expect(await waitForTerminalState(job)).toMatchObject({ state: 'completed' });
    expect(baseId).not.toBe(requiredSourceId);
    const table = (await getTableList(baseId)).data.find(({ name }) => name === 'Scoped Users')!;
    const fields = (await getFields(table.id)).data;
    const affected = fields.find(({ name }) => name === 'Required Actor')!;
    const control = fields.find(({ name }) => name === 'Required Control')!;
    expect(affected.notNull ?? false).toBe(false);
    expect(control.notNull).toBe(true);
    const records = (await getRecords(table.id, { fieldKeyType: FieldKeyType.Id })).records;
    expect(records).toHaveLength(2);
    expect(records.map(({ id }) => id).sort()).toEqual([...preservedIds].sort());
    expect(records.filter((record) => (record.fields[affected.id] ?? null) === null)).toHaveLength(
      1
    );
    expect(records.filter((record) => (record.fields[affected.id] ?? null) !== null)).toHaveLength(
      1
    );
    expect(
      records.find(({ id }) => id === preservedIds[0])?.fields[affected.id] ?? null
    ).toBeNull();
    for (const record of records) {
      expect(record.fields[control.id]).toMatchObject({
        id: actorId,
        title: actorName,
        email: actorEmail,
      });
      if ((record.fields[affected.id] ?? null) !== null) {
        expect(record.fields[affected.id]).toMatchObject({
          id: actorId,
          title: actorName,
          email: actorEmail,
        });
      }
    }
    const manager = app.get(DataDbClientManager);
    const compiler = await manager.dataKnexForBase(baseId);
    const dataPrisma = await manager.dataPrismaForBase(baseId);
    const [schema, dbTable] = table.dbTableName.split('.');
    const sql = compiler('information_schema.columns')
      .select('column_name', 'is_nullable')
      .where({ table_schema: schema, table_name: dbTable })
      .whereIn('column_name', [affected.dbFieldName, control.dbFieldName])
      .toQuery();
    const columns =
      await dataPrisma.$queryRawUnsafe<{ column_name: string; is_nullable: string }[]>(sql);
    expect(columns).toHaveLength(2);
    expect(
      columns.find(({ column_name }) => column_name === affected.dbFieldName)?.is_nullable
    ).toBe('YES');
    expect(
      columns.find(({ column_name }) => column_name === control.dbFieldName)?.is_nullable
    ).toBe('NO');
    await assertImportWarning(baseId, 1, [unknownId, unknownEmail, 'UNKNOWN REQUIRED USER']);
    await assertRequiredUserRelaxationWarning(baseId);
    expect(await prisma.user.findUnique({ where: { id: unknownId } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: unknownEmail } })).toBeNull();
  }, 60_000);

  it('keeps a mixed required multi-user field required after filtering', async () => {
    const { sourceId, archive: requiredArchive } = await createRequiredUserArchive(undefined, true);
    const preservedIds: string[] = [];
    const archive = await repackTableCsv(requiredArchive, ({ rows, table }) => {
      const field = requireNamed(table.fields, 'Required Actor');
      expect(field.notNull).toBe(true);
      expect(field.isMultipleCellValue).toBe(true);
      preservedIds.push(...rows.map(({ __id }) => __id));
      rows[0][field.dbFieldName] = JSON.stringify([
        { id: actorId, title: 'forged required actor' },
        { id: 'usrUnknownV1TeaImport', title: 'FORBIDDEN REQUIRED USER' },
        { id: actorId, email: 'wrong-pair@example.invalid' },
      ]);
      rows[1][field.dbFieldName] = JSON.stringify([]);
    });
    const { baseId, job } = await importArchive(archive);
    expect(await waitForTerminalState(job)).toMatchObject({ state: 'completed' });
    expect(baseId).not.toBe(sourceId);
    const table = requireNamed((await getTableList(baseId)).data, 'Scoped Users');
    const field = requireNamed((await getFields(table.id)).data, 'Required Actor');
    expect(field.notNull).toBe(true);
    const records = (await getRecords(table.id, { fieldKeyType: FieldKeyType.Id })).records;
    expect(records.map(({ id }) => id).sort()).toEqual([...preservedIds].sort());
    for (const record of records) {
      expect(record.fields[field.id]).toEqual(
        record.id === preservedIds[1]
          ? []
          : [expect.objectContaining({ id: actorId, title: actorName, email: actorEmail })]
      );
    }
    const manager = app.get(DataDbClientManager);
    const compiler = await manager.dataKnexForBase(baseId);
    const dataPrisma = await manager.dataPrismaForBase(baseId);
    const [schema, dbTable] = table.dbTableName.split('.');
    const sql = compiler('information_schema.columns')
      .select('is_nullable')
      .where({ table_schema: schema, table_name: dbTable, column_name: field.dbFieldName })
      .toQuery();
    expect(await dataPrisma.$queryRawUnsafe<{ is_nullable: string }[]>(sql)).toEqual([
      { is_nullable: 'NO' },
    ]);
    await assertImportWarning(baseId, 1, ['FORBIDDEN', 'forged', 'wrong-pair@example.invalid']);
    const notifications = await prisma.notification.findMany({
      where: { urlPath: `/base/${baseId}` },
    });
    expect(
      notifications.filter(
        ({ messageI18n }) =>
          JSON.parse(messageI18n ?? '{}').i18nKey ===
          'notification.baseImport.relaxedRequiredUserFields'
      )
    ).toEqual([]);
  }, 60_000);

  it('routes the public endpoint to V1 and canonicalizes every legal destination collaborator once per chunk', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => patchLegalIdentities(data, true));
    const originalLookup = PostgresUserLookupService.prototype.listTableUsersByIdentifiers;
    const originalPairLookup = PostgresUserLookupService.prototype.listUsersByIdentityPairs;
    const originalAdd = processor.queue.add.bind(processor.queue);
    let lookupCount = 0;
    let grantPromise: Promise<void> | undefined;
    const collaboratorId = getRandomString(16);
    let pendingScopedLookups = 0;
    let pendingPairLookups = 0;
    let grantStage = 'not-started';
    const nativeStages: Record<string, string> = {};
    const probeStage = (target: object, method: string) => {
      const methods = target as Record<string, (...args: unknown[]) => unknown>;
      const original = methods[method];
      if (typeof original !== 'function') throw new Error(`Missing diagnostic method: ${method}`);
      vi.spyOn(methods, method).mockImplementation(async function (this: unknown, ...args) {
        nativeStages[method] = 'pending';
        try {
          const result = await original.apply(this, args);
          nativeStages[method] = 'settled';
          return result;
        } catch (error) {
          nativeStages[method] = 'failed';
          throw error;
        }
      });
    };
    probeStage(BaseImportComputedService.prototype, 'recomputeForTables');
    probeStage(V2ContainerService.prototype, 'getContainerForBase');
    for (const method of [
      'getImportedLinks',
      'importJunctionChunk',
      'readArchive',
      'clearDanglingLinks',
    ]) {
      probeStage(BaseImportJunctionCsvQueueProcessor.prototype, method);
    }
    for (const method of [
      'executeSyncTables',
      'executeSyncMany',
      'collectBackfillFields',
      'ensurePhysicalColumnTypes',
      'loadSystemUserSnapshots',
    ]) {
      probeStage(ComputedFieldBackfillService.prototype, method);
    }
    probeStage(ComputedUpdatePlanner.prototype, 'planStage');
    probeStage(ComputedTableRecordQueryBuilder.prototype, 'prepare');
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
          grantStage = 'table-metadata';
          const table = await prisma.tableMeta.findUniqueOrThrow({
            where: { id: tableId },
            select: { baseId: true },
          });
          grantStage = 'collaborator-write';
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
          grantStage = 'completed';
        })();
        pendingScopedLookups += 1;
        try {
          await grantPromise;
          return await originalLookup.call(this, tableId, identifiers);
        } finally {
          pendingScopedLookups -= 1;
        }
      }
    );

    let pairLookupCount = 0;
    vi.spyOn(PostgresUserLookupService.prototype, 'listUsersByIdentityPairs').mockImplementation(
      async function (pairs) {
        pairLookupCount += 1;
        pendingPairLookups += 1;
        try {
          return await originalPairLookup.call(this, pairs);
        } finally {
          pendingPairLookups -= 1;
        }
      }
    );
    try {
      const { baseId, job } = await importArchive(archive);
      const diagnostics = () => ({
        lookupCount,
        pairLookupCount,
        pendingScopedLookups,
        pendingPairLookups,
        grantStage,
        nativeStages: JSON.stringify(nativeStages),
      });
      const terminal = await waitForTerminalState(job, diagnostics);
      expect(terminal.state).toBe('completed');
      try {
        await waitForImportedData(job, diagnostics);
      } catch (error) {
        let databaseWaits: unknown = 'unavailable';
        try {
          databaseWaits = await prisma.$queryRaw<unknown[]>`
            SELECT pid, state, wait_event_type, wait_event,
              pg_blocking_pids(pid) AS blockers,
              EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::double precision AS seconds,
              split_part(ltrim(query), ' ', 1) AS command
            FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND (wait_event_type = 'Lock' OR query LIKE ${`%${baseId}%`})
            ORDER BY query_start LIMIT 40
          `;
        } catch {
          // Preserve the original completion failure when activity is unavailable.
        }
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; databaseWaits=${JSON.stringify(databaseWaits)}`,
          { cause: error }
        );
      }
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
      const recordsById = new Map(records.map((record) => [record.id, record]));
      expect(recordsById.size).toBe(rowCount);
      expect([...recordsById.keys()].sort()).toEqual([...archiveRecordIds].sort());
      const firstRecord = recordsById.get(linkedSourceRecordId);
      const blankModifierControl = recordsById.get(archiveRecordIds[1]!);
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
      if (hasOrgTables) {
        expect(firstRecord.fields[fieldByName('Department Member').id]).toMatchObject({
          id: departmentMember.id,
          title: departmentMember.name,
          email: departmentMember.email,
        });
      } else {
        // Community database: the department cell was left empty (EE-only membership).
        expect(firstRecord.fields[fieldByName('Department Member').id]).toBeUndefined();
      }
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
    await waitForImportedData(job);
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
    const firstRecord = await getRecord(importedTable.id, archiveRecordIds[0]!);
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

  it('clears a destination-scoped id paired with another profile email and completes with a warning', async () => {
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
    await waitForImportedData(job);
    await assertSkippedUserCell(baseId, 0, 'Actor', [
      actorId,
      actorEmail,
      sourceOnlyMember.id,
      sourceOnlyEmail,
      'FORGED SCOPED MISMATCH',
    ]);
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
    await waitForImportedData(job);
    const { recordsById, fieldByName } = await assertSkippedUserCell(baseId, 0, 'Actor', [
      sourceOnlyMember.id,
      sourceOnlyEmail,
      'FORBIDDEN ID-ONLY PROFILE',
      'FORGED EXACT-PAIR PROFILE',
    ]);
    expect(recordsById.get(archiveRecordIds[1]!)!.fields[fieldByName('Actor').id]).toMatchObject({
      id: sourceOnlyMember.id,
      title: sourceOnlyMember.name,
      email: sourceOnlyEmail,
    });
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
    'clears only the invalid user cell and restores all rows for a %s',
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
      await waitForImportedData(job);
      await assertSkippedUserCell(baseId, targetRowIndex, 'Actor', [
        getId(),
        getEmail(),
        'FORBIDDEN ARCHIVE IDENTITY',
      ]);
      if (!useIdOnlySnapshot) {
        expect(
          await prisma.user.count({ where: { OR: [{ id: getId() }, { email: getEmail() }] } })
        ).toBe(0);
        expect(
          await prisma.collaborator.count({
            where: { resourceId: { in: [spaceId, baseId] }, principalId: getId() },
          })
        ).toBe(0);
      }
    },
    30_000
  );

  it.each([true, false])(
    'filters unauthorized multi-user members without losing legal members (keep legal: %s)',
    async (keepLegal) => {
      const archive = await repackTableCsv(sourceArchive, (data) => {
        patchLegalIdentities(data);
        const multipleField = requireNamed(data.table.fields, 'Multiple Users');
        data.rows[0][multipleField.dbFieldName] = JSON.stringify([
          ...(keepLegal ? [{ id: actorId, title: 'FORGED LEGAL USER', email: actorEmail }] : []),
          { id: sourceOnlyMember.id, title: 'FORBIDDEN BARE USER' },
          { id: actorId, email: sourceOnlyEmail, title: 'FORBIDDEN MISMATCHED USER' },
          { id: 'usrUnknownV1TeaImport', title: 'FORBIDDEN UNKNOWN USER' },
          ...(keepLegal
            ? [
                { id: sourceOnlyMember.id, email: sourceOnlyEmail, title: 'FORGED EXACT PAIR' },
                { id: spaceMember.id, title: 'FORGED SCOPED USER' },
              ]
            : []),
        ]);
      });

      const { baseId, job } = await importArchive(archive);
      await waitForImportedData(job);
      await assertSkippedUserCell(
        baseId,
        0,
        'Multiple Users',
        [sourceOnlyMember.id, sourceOnlyEmail, 'FORBIDDEN', 'FORGED'],
        keepLegal
          ? [
              expect.objectContaining({ id: actorId, title: actorName, email: actorEmail }),
              expect.objectContaining({
                id: sourceOnlyMember.id,
                title: sourceOnlyMember.name,
                email: sourceOnlyEmail,
              }),
              expect.objectContaining({
                id: spaceMember.id,
                title: spaceMember.name,
                email: spaceMember.email,
              }),
            ]
          : []
      );
    },
    30_000
  );

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

  it('restores both chunks and clears only the later outsider cell with a warning', async () => {
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
    await waitForImportedData(job);
    await assertSkippedUserCell(baseId, chunkSize, 'Actor', [
      sourceOnlyMember.id,
      sourceOnlyEmail,
      'LATE FORBIDDEN ARCHIVE IDENTITY',
    ]);
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
    await assertImportFailureNotification(baseId, [
      'Injected destination lookup failure',
      'Failed to validate imported user references',
      actorId,
      actorEmail,
      spaceMember.id,
      spaceMemberEmail,
      sourceOnlyMember.id,
      sourceOnlyEmail,
    ]);
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
    await assertImportFailureNotification(baseId, [
      'PRIVATE PAIR LOOKUP DETAILS',
      'Failed to validate imported user references',
      'FORGED PAIR LOOKUP',
      actorId,
      actorEmail,
      sourceOnlyMember.id,
      sourceOnlyMember.name,
      sourceOnlyEmail,
    ]);
  }, 30_000);
});
