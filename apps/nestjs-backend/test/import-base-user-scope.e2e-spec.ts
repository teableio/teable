/* eslint-disable @typescript-eslint/naming-convention */
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentItem, IUserCellValue } from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  getRandomString,
  HttpErrorCode,
  NotificationSeverityEnum,
  NotificationTypeEnum,
  Role,
  SortFunc,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson, INotifyVo, IUserMeVo } from '@teable/openapi';
import {
  CollaboratorType,
  deleteSpaceCollaborator,
  emailBaseInvitation,
  emailSpaceInvitation,
  exportBase,
  getFields,
  getTableList,
  importBase,
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
import { DataDbClientManager } from '../src/global/data-db-client-manager.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createAwaitWithEventWithResult } from './utils/event-promise';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createRecords,
  createSpace,
  createTable,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
} from './utils/init-app';

const rowCount = 120;
const committedBatchSize = 100;
const password = '12345678';

type ArchiveRows = {
  columns: string[];
  rows: Array<Record<string, string>>;
  table: IBaseJson['tables'][number];
};

describe('public .tea import user scope (e2e)', () => {
  const spaceId = globalThis.testConfig.spaceId;
  const actorId = globalThis.testConfig.userId;
  const actorName = globalThis.testConfig.userName;
  const actorEmail = globalThis.testConfig.email;
  const sourceName = `user-scope-import-${Date.now()}`;
  const organizationId = `org${getRandomString(16)}`;
  const rootDepartmentId = `dpt${getRandomString(16)}`;
  const childDepartmentId = `dpt${getRandomString(16)}`;
  const departmentCollaboratorId = getRandomString(16);

  let app: INestApplication;
  let appUrl: string;
  let prisma: PrismaService;
  let sourceSpaceId: string;
  let sourceBaseId: string;
  let sourceArchive: Buffer;
  let spaceMember: IUserMeVo;
  let sourceOnlyMember: IUserMeVo;
  let systemSpoof: IUserMeVo;
  let scopedSystem: IUserMeVo;
  let targetBaseMember: IUserMeVo;
  let directDepartmentMember: IUserMeVo;
  let childDepartmentMember: IUserMeVo;
  let spaceMemberEmail: string;
  let sourceOnlyEmail: string;
  let systemSpoofEmail: string;
  let scopedSystemEmail: string;
  let importStartedAt: Date;
  // The organization/department tables are an EE-only schema; the community
  // (OSS) e2e database has none of them. Detected at boot so the department
  // seed and the department-scope case skip cleanly there.
  let hasOrgTables = false;

  const importedBaseIds = new Set<string>();

  const userCell = (id: string, title: string, email: string): string =>
    JSON.stringify({
      id,
      title,
      email,
      avatarUrl: 'https://attacker.invalid/avatar.png',
    });

  const waitForImportedBaseId = async (): Promise<string> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const imported = await prisma.base.findFirst({
        where: {
          spaceId,
          name: sourceName,
          id: { not: sourceBaseId },
          createdTime: { gte: importStartedAt },
          deletedTime: null,
        },
        orderBy: { createdTime: 'desc' },
        select: { id: true },
      });
      if (imported) {
        importedBaseIds.add(imported.id);
        return imported.id;
      }
      await delay(50);
    }
    throw new Error('The import did not commit its base structure');
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

  const patchValidIdentities = ({ rows, table }: ArchiveRows) => {
    const actorField = table.fields.find((field) => field.name === 'Actor')!;
    const memberField = table.fields.find((field) => field.name === 'Space Member')!;
    const systemField = table.fields.find((field) => field.name === 'Scoped System')!;
    const emptyField = table.fields.find((field) => field.name === 'Empty User')!;
    const multipleField = table.fields.find((field) => field.name === 'Multiple Users')!;
    const createdByCycle = [actorId, spaceMember.id, '', scopedSystem.id];
    const modifiedByCycle = [spaceMember.id, actorId, '', scopedSystem.id];

    for (const [index, row] of rows.entries()) {
      row[actorField.dbFieldName] = JSON.stringify({ id: actorId, title: 'forged actor' });
      row[memberField.dbFieldName] = JSON.stringify({
        id: spaceMember.id,
        title: 'forged space member',
      });
      row[systemField.dbFieldName] = JSON.stringify({
        id: scopedSystem.id,
        title: 'forged scoped system',
      });
      row[emptyField.dbFieldName] = 'null';
      row[multipleField.dbFieldName] = '[]';
      row.__created_by = createdByCycle[index % createdByCycle.length]!;
      row.__last_modified_by = modifiedByCycle[index % modifiedByCycle.length]!;
    }
  };

  const importArchive = async (archiveBytes: Buffer) => {
    importStartedAt = new Date(Date.now() - 1_000);
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
          filename: 'user-scope.tea',
          contentType: 'application/zip',
          contentLength: archiveBytes.length,
        })
    );

    return getError(() => importBase({ notify: notify as unknown as INotifyVo, spaceId }));
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

  const getImportedRows = async (baseId: string) => {
    const importedTable = (await getTableList(baseId)).data.find(
      (table) => table.name === 'Scoped Users'
    )!;
    const fields = (await getFields(importedTable.id)).data;
    const fieldByName = (name: string) => fields.find((field) => field.name === name)!;
    const records = (
      await getRecords(importedTable.id, {
        fieldKeyType: FieldKeyType.Id,
        take: rowCount,
        orderBy: [{ fieldId: fieldByName('Title').id, order: SortFunc.Asc }],
      })
    ).records;
    expect(records).toHaveLength(rowCount);
    expect(records.map((record) => record.fields[fieldByName('Title').id])).toEqual(
      Array.from({ length: rowCount }, (_, index) => `row-${String(index).padStart(3, '0')}`)
    );
    for (const record of records) {
      expect(record.fields[fieldByName('Scoped System').id]).toMatchObject({
        id: scopedSystem.id,
        title: scopedSystem.name,
        email: scopedSystem.email,
      });
    }
    expect(JSON.stringify(records)).not.toContain('forged');
    expect(JSON.stringify(records)).not.toContain('attacker.invalid');
    return { records, fieldByName };
  };

  const assertSkippedUserCell = async (
    archive: Buffer,
    forbiddenValues: string[],
    rowIndex = 0,
    fieldName = 'Actor',
    expectedUsers: IUserCellValue[] = []
  ) => {
    expect(await importArchive(archive)).toBeUndefined();
    const baseId = await waitForImportedBaseId();
    const result = await getImportedRows(baseId);
    const skippedValue = result.records[rowIndex]!.fields[result.fieldByName(fieldName).id];
    if (fieldName === 'Multiple Users') {
      expect(skippedValue ?? []).toEqual(expectedUsers);
    } else {
      expect(skippedValue ?? null).toBeNull();
    }
    expect(result.records[2]!.fields[result.fieldByName('Actor').id]).toMatchObject({
      id: actorId,
      title: actorName,
      email: actorEmail,
    });
    const createdByCycle = [actorId, spaceMember.id, '', scopedSystem.id];
    const modifiedByCycle = [spaceMember.id, actorId, '', scopedSystem.id];
    for (const [index, record] of result.records.entries()) {
      const createdBy = createdByCycle[index % createdByCycle.length];
      const modifiedBy = modifiedByCycle[index % modifiedByCycle.length];
      if (createdBy) {
        expect(record.fields[result.fieldByName('Created By').id]).toMatchObject({ id: createdBy });
      }
      if (modifiedBy) {
        expect(record.fields[result.fieldByName('Last Modified By').id]).toMatchObject({
          id: modifiedBy,
        });
      }
    }
    await assertImportWarning(baseId, 1, forbiddenValues);
    expect(
      await prisma.collaborator.count({
        where: {
          resourceId: { in: [spaceId, baseId] },
          principalId: sourceOnlyMember.id,
          principalType: PrincipalType.User,
        },
      })
    ).toBe(0);
    return { ...result, baseId };
  };

  const assertScopedRejection = async (
    archiveBytes: Buffer,
    forbiddenValues: string[],
    expectedDomainCode: string
  ) => {
    const error = await importArchive(archiveBytes);
    expect(error?.status).toBeGreaterThanOrEqual(400);
    expect(error?.status).toBeLessThan(500);
    expect(error?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
    expect((error?.data as { domainCode?: string } | undefined)?.domainCode).toBe(
      expectedDomainCode
    );

    const serializedError = JSON.stringify(error).toLowerCase();
    for (const value of forbiddenValues) {
      expect(serializedError).not.toContain(value.toLowerCase());
    }

    const importedBaseId = await waitForImportedBaseId();
    const tables = (await getTableList(importedBaseId)).data;
    expect(tables.map((table) => table.name)).toContain('Scoped Users');
    const importedTable = tables.find((table) => table.name === 'Scoped Users')!;
    expect(
      (await getRecords(importedTable.id, { fieldKeyType: FieldKeyType.Id, take: rowCount }))
        .records
    ).toHaveLength(0);
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    prisma = app.get(PrismaService);

    const orgProbe = await prisma.$queryRaw<{ present: boolean }[]>`
      select to_regclass('organization') is not null as present
    `;
    hasOrgTables = Boolean(orgProbe[0]?.present);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    spaceMemberEmail = `tea-space-member-${suffix}@example.com`;
    sourceOnlyEmail = `tea-source-only-${suffix}@example.com`;
    systemSpoofEmail = `tea-system-spoof-${suffix}@example.com`;
    scopedSystemEmail = `tea-scoped-system-${suffix}@example.com`;
    const targetBaseMemberEmail = `tea-target-base-${suffix}@example.com`;
    const directDepartmentEmail = `tea-department-direct-${suffix}@example.com`;
    const childDepartmentEmail = `tea-department-child-${suffix}@example.com`;

    const [
      spaceMemberAxios,
      sourceOnlyAxios,
      systemSpoofAxios,
      scopedSystemAxios,
      targetBaseMemberAxios,
      directDepartmentAxios,
      childDepartmentAxios,
    ] = await Promise.all([
      createNewUserAxios({ email: spaceMemberEmail, password }),
      createNewUserAxios({ email: sourceOnlyEmail, password }),
      createNewUserAxios({ email: systemSpoofEmail, password }),
      createNewUserAxios({ email: scopedSystemEmail, password }),
      createNewUserAxios({ email: targetBaseMemberEmail, password }),
      createNewUserAxios({ email: directDepartmentEmail, password }),
      createNewUserAxios({ email: childDepartmentEmail, password }),
    ]);
    [
      spaceMember,
      sourceOnlyMember,
      systemSpoof,
      scopedSystem,
      targetBaseMember,
      directDepartmentMember,
      childDepartmentMember,
    ] = await Promise.all([
      spaceMemberAxios.get<IUserMeVo>(USER_ME).then(({ data }) => data),
      sourceOnlyAxios.get<IUserMeVo>(USER_ME).then(({ data }) => data),
      systemSpoofAxios.get<IUserMeVo>(USER_ME).then(({ data }) => data),
      scopedSystemAxios.get<IUserMeVo>(USER_ME).then(({ data }) => data),
      targetBaseMemberAxios.get<IUserMeVo>(USER_ME).then(({ data }) => data),
      directDepartmentAxios.get<IUserMeVo>(USER_ME).then(({ data }) => data),
      childDepartmentAxios.get<IUserMeVo>(USER_ME).then(({ data }) => data),
    ]);

    await Promise.all([
      prisma.user.update({
        where: { id: spaceMember.id },
        data: { name: 'Canonical Space Member' },
      }),
      prisma.user.update({
        where: { id: scopedSystem.id },
        data: { name: 'Canonical Scoped System' },
      }),
      prisma.user.update({
        where: { id: targetBaseMember.id },
        data: { name: 'Canonical Target Base Member' },
      }),
      prisma.user.update({
        where: { id: directDepartmentMember.id },
        data: { name: 'Canonical Direct Department Member' },
      }),
      prisma.user.update({
        where: { id: childDepartmentMember.id },
        data: { name: 'Canonical Child Department Member' },
      }),
    ]);
    spaceMember = { ...spaceMember, name: 'Canonical Space Member' };
    scopedSystem = { ...scopedSystem, name: 'Canonical Scoped System' };
    targetBaseMember = { ...targetBaseMember, name: 'Canonical Target Base Member' };
    directDepartmentMember = {
      ...directDepartmentMember,
      name: 'Canonical Direct Department Member',
    };
    childDepartmentMember = {
      ...childDepartmentMember,
      name: 'Canonical Child Department Member',
    };

    if (hasOrgTables) {
      await prisma.$executeRaw`
      insert into organization (id, name, created_by)
      values (${organizationId}, ${'Tea Import Scope Organization'}, ${actorId})
    `;
      await prisma.$executeRaw`
      insert into organization_space (id, organization_id, space_id)
      values (${getRandomString(16)}, ${organizationId}, ${spaceId})
    `;
      for (const user of [directDepartmentMember, childDepartmentMember]) {
        await prisma.$executeRaw`
        insert into organization_user (id, organization_id, user_id)
        values (${getRandomString(16)}, ${organizationId}, ${user.id})
      `;
      }
      await prisma.$executeRaw`
      insert into organization_department (id, name, organization_id, path, created_by)
      values (
        ${rootDepartmentId},
        ${'Import Scope Root'},
        ${organizationId},
        ${JSON.stringify([rootDepartmentId])}::jsonb,
        ${actorId}
      )
    `;
      await prisma.$executeRaw`
      insert into organization_department (
        id,
        name,
        organization_id,
        parent_id,
        path,
        created_by
      )
      values (
        ${childDepartmentId},
        ${'Import Scope Child'},
        ${organizationId},
        ${rootDepartmentId},
        ${JSON.stringify([rootDepartmentId, childDepartmentId])}::jsonb,
        ${actorId}
      )
    `;
      for (const [userId, departmentId] of [
        [directDepartmentMember.id, rootDepartmentId],
        [childDepartmentMember.id, childDepartmentId],
      ]) {
        await prisma.$executeRaw`
        insert into organization_user_department (id, user_id, department_id)
        values (${getRandomString(16)}, ${userId}, ${departmentId})
      `;
      }
      await prisma.collaborator.create({
        data: {
          id: departmentCollaboratorId,
          resourceId: spaceId,
          resourceType: CollaboratorType.Space,
          roleName: Role.Editor,
          principalId: rootDepartmentId,
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

    sourceSpaceId = (await createSpace({ name: `${sourceName}-source-space` })).id;
    sourceBaseId = (await createBase({ name: sourceName, spaceId: sourceSpaceId })).id;
    await emailBaseInvitation({
      baseId: sourceBaseId,
      emailBaseInvitationRo: {
        emails: [sourceOnlyEmail, systemSpoofEmail],
        role: Role.Editor,
      },
    });
    await prisma.user.updateMany({
      where: { id: { in: [systemSpoof.id, scopedSystem.id] } },
      data: { isSystem: true },
    });

    await createTable(sourceBaseId, {
      name: 'Scoped Users',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Actor', type: FieldType.User },
        { name: 'Space Member', type: FieldType.User },
        { name: 'Scoped System', type: FieldType.User },
        { name: 'Empty User', type: FieldType.User },
        {
          name: 'Multiple Users',
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
    for (const baseId of importedBaseIds) {
      await prisma.notification.deleteMany({
        where: { toUserId: actorId, urlPath: `/base/${baseId}` },
      });
      await permanentDeleteBase(baseId).catch(() => undefined);
    }
    importedBaseIds.clear();
  });

  afterAll(async () => {
    if (sourceBaseId) await permanentDeleteBase(sourceBaseId).catch(() => undefined);
    if (sourceSpaceId) await permanentDeleteSpace(sourceSpaceId).catch(() => undefined);
    for (const principalId of [spaceMember?.id, scopedSystem?.id]) {
      if (!principalId) continue;
      await deleteSpaceCollaborator({
        spaceId,
        deleteSpaceCollaboratorRo: {
          principalId,
          principalType: PrincipalType.User,
        },
      }).catch(() => undefined);
    }
    if (hasOrgTables) {
      await prisma.collaborator.deleteMany({ where: { id: departmentCollaboratorId } });
      await prisma.$executeRaw`delete from organization where id = ${organizationId}`;
    }
    await app?.close();
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
    // BaseImportService restores tableDataImportBatchSize=100 records serially.
    const boundary = committedBatchSize;
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
    const importStart = new Date();
    const error = await importArchive(archive);
    const retainedBase = await prisma.base.findFirstOrThrow({
      where: {
        spaceId,
        name: 'Required user source',
        id: { not: sourceId },
        createdBy: actorId,
        createdTime: { gte: importStart },
        deletedTime: null,
      },
      select: { id: true },
    });
    const baseId = retainedBase.id;
    importedBaseIds.add(baseId);
    expect(error?.status).toBe(400);
    const forbiddenValues = [unknownId, unknownEmail, 'LATE MALFORMED REQUIRED USER'];
    const serializedError = JSON.stringify(error);
    for (const value of [...forbiddenValues, actorId, actorEmail]) {
      expect(serializedError).not.toContain(value);
    }
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
    const notify = await app.get(ClsService).runWith<Promise<IAttachmentItem>>(
      {
        user: { id: actorId, name: actorName, email: actorEmail, isAdmin: null },
      } as unknown as ClsStore,
      () =>
        app.get(AttachmentsService).uploadFromStream(Readable.from(archive), {
          filename: 'required-user.tea',
          contentType: 'application/zip',
          contentLength: archive.length,
        })
    );
    const importStart = new Date();
    let baseId: string;
    try {
      const response = await importBase({ notify: notify as unknown as INotifyVo, spaceId });
      expect(response.status).toBe(201);
      baseId = response.data.base.id;
      importedBaseIds.add(baseId);
    } finally {
      const created = await prisma.base.findMany({
        where: {
          spaceId,
          name: 'Required user source',
          createdBy: actorId,
          createdTime: { gte: importStart },
          deletedTime: null,
        },
        select: { id: true },
      });
      for (const base of created) importedBaseIds.add(base.id);
    }
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
      const field = table.fields.find(({ name }) => name === 'Required Actor')!;
      expect(field.notNull).toBe(true);
      expect(field.isMultipleCellValue).toBe(true);
      preservedIds.push(...rows.map(({ __id }) => __id));
      rows[0][field.dbFieldName] = JSON.stringify([
        { id: actorId, title: 'forged required actor' },
        { id: 'usrUnknownEditableUser', title: 'FORBIDDEN REQUIRED USER' },
        { id: actorId, email: 'wrong-pair@example.invalid' },
      ]);
    });
    const importStart = new Date();
    expect(await importArchive(archive)).toBeUndefined();
    const imported = await prisma.base.findFirstOrThrow({
      where: {
        spaceId,
        name: 'Required user source',
        id: { not: sourceId },
        createdBy: actorId,
        createdTime: { gte: importStart },
        deletedTime: null,
      },
    });
    const baseId = imported.id;
    importedBaseIds.add(baseId);
    const table = (await getTableList(baseId)).data.find(({ name }) => name === 'Scoped Users')!;
    const field = (await getFields(table.id)).data.find(({ name }) => name === 'Required Actor')!;
    expect(field.notNull).toBe(true);
    const records = (await getRecords(table.id, { fieldKeyType: FieldKeyType.Id })).records;
    expect(records.map(({ id }) => id).sort()).toEqual([...preservedIds].sort());
    for (const record of records) {
      expect(record.fields[field.id]).toEqual([
        expect.objectContaining({ id: actorId, title: actorName, email: actorEmail }),
      ]);
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

  it('accepts an exact complete user pair across spaces without trusting its presentation', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = userCell(
        sourceOnlyMember.id,
        'FORGED CROSS SPACE TITLE',
        sourceOnlyEmail
      );
      const multipleField = data.table.fields.find((field) => field.name === 'Multiple Users')!;
      data.rows[0]![multipleField.dbFieldName] = JSON.stringify([
        { id: actorId },
        { id: sourceOnlyMember.id, email: sourceOnlyEmail, title: 'FORGED MULTIPLE PAIR' },
      ]);
    });

    expect(await importArchive(archive)).toBeUndefined();
    const importedBaseId = await waitForImportedBaseId();
    const sourceBase = await prisma.base.findUniqueOrThrow({ where: { id: sourceBaseId } });
    const importedBase = await prisma.base.findUniqueOrThrow({ where: { id: importedBaseId } });
    expect(sourceBase.spaceId).toBe(sourceSpaceId);
    expect(importedBase.spaceId).toBe(spaceId);
    expect(importedBase.spaceId).not.toBe(sourceBase.spaceId);
    expect(
      await prisma.collaborator.count({
        where: {
          resourceId: sourceBaseId,
          principalId: sourceOnlyMember.id,
          principalType: PrincipalType.User,
        },
      })
    ).toBe(1);
    const targetBases = await prisma.base.findMany({ where: { spaceId }, select: { id: true } });
    expect(
      await prisma.collaborator.count({
        where: {
          resourceId: { in: [spaceId, ...targetBases.map(({ id }) => id)] },
          principalId: sourceOnlyMember.id,
          principalType: PrincipalType.User,
        },
      })
    ).toBe(0);
    const importedTable = (await getTableList(importedBaseId)).data.find(
      (table) => table.name === 'Scoped Users'
    )!;
    const fields = (await getFields(importedTable.id)).data;
    const actorField = fields.find((field) => field.name === 'Actor')!;
    const titleField = fields.find((field) => field.name === 'Title')!;
    const records = await getRecords(importedTable.id, {
      fieldKeyType: FieldKeyType.Id,
      take: rowCount,
      orderBy: [{ fieldId: titleField.id, order: SortFunc.Asc }],
    });
    expect(records.records).toHaveLength(rowCount);
    expect(records.records[0]!.fields[actorField.id]).toMatchObject({
      id: sourceOnlyMember.id,
      title: sourceOnlyMember.name,
      email: sourceOnlyEmail,
    });
    const multipleField = fields.find((field) => field.name === 'Multiple Users')!;
    expect(records.records[0]!.fields[multipleField.id]).toEqual([
      expect.objectContaining({ id: actorId, title: actorName, email: actorEmail }),
      expect.objectContaining({
        id: sourceOnlyMember.id,
        title: sourceOnlyMember.name,
        email: sourceOnlyEmail,
      }),
    ]);
    expect(JSON.stringify(records.records[0]!.fields)).not.toContain('attacker.invalid');
    expect(JSON.stringify(records.records[0]!.fields)).not.toContain('FORGED CROSS SPACE TITLE');
  }, 30_000);

  it('clears a bare outsider cell and restores every batch with a warning', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = JSON.stringify({ id: sourceOnlyMember.id });
    });
    await assertSkippedUserCell(archive, [sourceOnlyMember.id, sourceOnlyEmail]);
  }, 30_000);

  it('clears a mismatched pair even when its id is a target collaborator', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = userCell(actorId, 'FORGED PAIR', sourceOnlyEmail);
    });
    await assertSkippedUserCell(archive, [actorId, actorEmail, sourceOnlyEmail, 'FORGED PAIR']);
  }, 30_000);

  it.each([undefined, 'wrong-pair@example.invalid'])(
    'does not let an invalid reference borrow another cell pair (%s)',
    async (email) => {
      const archive = await repackTableCsv(sourceArchive, (data) => {
        patchValidIdentities(data);
        const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
        data.rows[0]![actorField.dbFieldName] = userCell(
          sourceOnlyMember.id,
          'VALID PAIR IN ANOTHER CELL',
          sourceOnlyEmail
        );
        data.rows[1]![actorField.dbFieldName] = JSON.stringify({
          id: sourceOnlyMember.id,
          ...(email === undefined ? {} : { email }),
        });
      });
      const { records, fieldByName } = await assertSkippedUserCell(
        archive,
        [sourceOnlyMember.id, sourceOnlyEmail, 'VALID PAIR IN ANOTHER CELL'],
        1
      );
      expect(records[0]!.fields[fieldByName('Actor').id]).toMatchObject({
        id: sourceOnlyMember.id,
        title: sourceOnlyMember.name,
        email: sourceOnlyEmail,
      });
    },
    30_000
  );

  it('fails closed when exact pair lookup fails without exposing its error or profiles', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = userCell(
        sourceOnlyMember.id,
        'FORGED PAIR LOOKUP',
        sourceOnlyEmail
      );
    });
    const lookupSpy = vi
      .spyOn(PostgresUserLookupService.prototype, 'listUsersByIdentityPairs')
      .mockImplementationOnce(async () =>
        err(domainError.infrastructure({ message: 'PRIVATE PAIR LOOKUP DETAILS' }))
      );
    try {
      const error = await importArchive(archive);
      expect(error?.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(error)).not.toContain('PRIVATE PAIR LOOKUP DETAILS');
      expect(JSON.stringify(error)).not.toContain(sourceOnlyMember.id);
      expect(JSON.stringify(error)).not.toContain(sourceOnlyEmail);
      const importedBaseId = await waitForImportedBaseId();
      const importedTable = (await getTableList(importedBaseId)).data.find(
        (table) => table.name === 'Scoped Users'
      )!;
      expect((await getRecords(importedTable.id, { take: rowCount })).records).toHaveLength(0);
    } finally {
      lookupSpy.mockRestore();
    }
  }, 30_000);

  it.each(['__created_by', '__last_modified_by'])(
    'does not let a complete field pair authorize the bare author in %s',
    async (authorColumn) => {
      const archive = await repackTableCsv(sourceArchive, (data) => {
        patchValidIdentities(data);
        const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
        data.rows[0]![actorField.dbFieldName] = userCell(
          sourceOnlyMember.id,
          'FORGED AUTHOR TITLE',
          sourceOnlyEmail
        );
        data.rows[0]![authorColumn] = sourceOnlyMember.id;
      });
      expect(await importArchive(archive)).toBeUndefined();
      const baseId = await waitForImportedBaseId();
      const { records, fieldByName } = await getImportedRows(baseId);
      expect(records[0]!.fields[fieldByName('Actor').id]).toMatchObject({
        id: sourceOnlyMember.id,
        title: sourceOnlyMember.name,
        email: sourceOnlyEmail,
      });
      const authorField = fieldByName(
        authorColumn === '__created_by' ? 'Created By' : 'Last Modified By'
      );
      expect(records[0]!.fields[authorField.id]).toMatchObject({ id: actorId, title: actorName });
      expect(JSON.stringify(records[0]!.fields[authorField.id])).not.toContain(sourceOnlyMember.id);
      await assertImportWarning(baseId, 1, [
        sourceOnlyMember.id,
        sourceOnlyEmail,
        'FORGED AUTHOR TITLE',
      ]);
    },
    30_000
  );

  it('replaces an unknown creator with the importer and restores all rows with a warning', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      data.rows[0]!.__created_by = 'usrUnknownTeaImport';
    });

    expect(await importArchive(archive)).toBeUndefined();
    const baseId = await waitForImportedBaseId();
    const { records, fieldByName } = await getImportedRows(baseId);
    expect(records[0]!.fields[fieldByName('Created By').id]).toMatchObject({
      id: actorId,
      title: actorName,
    });
    expect(records[0]!.fields[fieldByName('Last Modified By').id]).toMatchObject({
      id: spaceMember.id,
      title: spaceMember.name,
    });
    expect(JSON.stringify(records)).not.toContain('usrUnknownTeaImport');
    await assertImportWarning(baseId, 1, ['usrUnknownTeaImport']);
  }, 30_000);

  it('replaces a source-base-only system modifier with the importer without elevating it', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      data.rows[0]!.__last_modified_by = systemSpoof.id;
    });

    expect(await importArchive(archive)).toBeUndefined();
    const baseId = await waitForImportedBaseId();
    const { records, fieldByName } = await getImportedRows(baseId);
    expect(records[0]!.fields[fieldByName('Last Modified By').id]).toMatchObject({
      id: actorId,
      title: actorName,
    });
    expect(JSON.stringify(records)).not.toContain(systemSpoof.id);
    expect(JSON.stringify(records)).not.toContain(systemSpoofEmail);
    await assertImportWarning(baseId, 1, [systemSpoof.id, systemSpoofEmail]);
  }, 30_000);

  it('clears an unknown id/email identity without creating a user or granting access', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = userCell(
        'usrUnknownEditableUser',
        'UNKNOWN EDITABLE USER',
        'unknown-editable@example.com'
      );
    });

    const { baseId } = await assertSkippedUserCell(archive, [
      'usrUnknownEditableUser',
      'UNKNOWN EDITABLE USER',
      'unknown-editable@example.com',
    ]);
    expect(
      await prisma.user.count({
        where: {
          OR: [{ id: 'usrUnknownEditableUser' }, { email: 'unknown-editable@example.com' }],
        },
      })
    ).toBe(0);
    expect(
      await prisma.collaborator.count({
        where: { resourceId: { in: [spaceId, baseId] }, principalId: 'usrUnknownEditableUser' },
      })
    ).toBe(0);
  }, 30_000);

  it.each([true, false])(
    'filters unauthorized multi-user members without losing legal members (keep legal: %s)',
    async (keepLegal) => {
      const archive = await repackTableCsv(sourceArchive, (data) => {
        patchValidIdentities(data);
        const multipleField = data.table.fields.find((field) => field.name === 'Multiple Users')!;
        data.rows[0][multipleField.dbFieldName] = JSON.stringify([
          ...(keepLegal ? [{ id: actorId, title: 'FORGED LEGAL USER', email: actorEmail }] : []),
          { id: sourceOnlyMember.id, title: 'FORBIDDEN BARE USER' },
          { id: actorId, email: sourceOnlyEmail, title: 'FORBIDDEN MISMATCHED USER' },
          { id: 'usrUnknownEditableUser', title: 'FORBIDDEN UNKNOWN USER' },
          ...(keepLegal
            ? [
                { id: sourceOnlyMember.id, email: sourceOnlyEmail, title: 'FORGED EXACT PAIR' },
                { id: spaceMember.id, title: 'FORGED SCOPED USER' },
              ]
            : []),
        ]);
      });
      await assertSkippedUserCell(
        archive,
        [sourceOnlyMember.id, sourceOnlyEmail, 'FORBIDDEN', 'FORGED'],
        0,
        'Multiple Users',
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

  it('rejects an array-shaped value in a single user field', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = JSON.stringify([
        { id: actorId, title: 'ARRAY SHAPE', email: actorEmail },
      ]);
    });

    await assertScopedRejection(
      archive,
      [actorId, actorEmail, 'ARRAY SHAPE'],
      'validation.field.invalid_user_format'
    );
  }, 30_000);

  it('preserves and canonicalizes actor, space-member, and scoped-system values and attribution', async () => {
    const archive = await repackTableCsv(sourceArchive, patchValidIdentities);
    const error = await importArchive(archive);
    expect(error).toBeUndefined();

    const importedBaseId = await waitForImportedBaseId();
    const importedTable = (await getTableList(importedBaseId)).data.find(
      (table) => table.name === 'Scoped Users'
    )!;
    const fields = (await getFields(importedTable.id)).data;
    const fieldByName = (name: string) => fields.find((field) => field.name === name)!;
    const records = (
      await getRecords(importedTable.id, {
        fieldKeyType: FieldKeyType.Id,
        take: rowCount,
        orderBy: [{ fieldId: fieldByName('Title').id, order: SortFunc.Asc }],
      })
    ).records;

    expect(records).toHaveLength(rowCount);
    expect(records[0]!.fields[fieldByName('Actor').id]).toMatchObject({
      id: actorId,
      title: actorName,
      email: actorEmail,
    });
    expect(records[0]!.fields[fieldByName('Space Member').id]).toMatchObject({
      id: spaceMember.id,
      title: spaceMember.name,
      email: spaceMember.email,
    });
    expect(records[0]!.fields[fieldByName('Scoped System').id]).toMatchObject({
      id: scopedSystem.id,
      title: scopedSystem.name,
      email: scopedSystem.email,
    });
    expect(records[0]!.fields[fieldByName('Empty User').id] ?? null).toBeNull();
    expect(records[0]!.fields[fieldByName('Multiple Users').id] ?? []).toEqual([]);
    expect(records[0]!.fields[fieldByName('Created By').id] as IUserCellValue).toMatchObject({
      id: actorId,
      title: actorName,
    });
    expect(records[0]!.fields[fieldByName('Last Modified By').id] as IUserCellValue).toMatchObject({
      id: spaceMember.id,
      title: spaceMember.name,
    });
    expect(records[3]!.fields[fieldByName('Created By').id] as IUserCellValue).toMatchObject({
      id: scopedSystem.id,
      title: scopedSystem.name,
    });
    expect(records[3]!.fields[fieldByName('Last Modified By').id] as IUserCellValue).toMatchObject({
      id: scopedSystem.id,
      title: scopedSystem.name,
    });
    expect(JSON.stringify(records[0]!.fields)).not.toContain('forged');
  }, 30_000);

  it('accepts a user granted directly on the target base before the batch lookup', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = JSON.stringify({
        id: targetBaseMember.id,
        title: 'forged target-base member',
      });
    });
    const original = PostgresUserLookupService.prototype.listTableUsersByIdentifiers;
    const collaboratorId = getRandomString(16);
    let granted = false;
    const lookupSpy = vi
      .spyOn(PostgresUserLookupService.prototype, 'listTableUsersByIdentifiers')
      .mockImplementation(async function (tableId, identifiers) {
        if (!granted) {
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
          granted = true;
        }
        return original.call(this, tableId, identifiers);
      });

    try {
      expect(await importArchive(archive)).toBeUndefined();
      const importedBaseId = await waitForImportedBaseId();
      const importedTable = (await getTableList(importedBaseId)).data.find(
        (table) => table.name === 'Scoped Users'
      )!;
      const fields = (await getFields(importedTable.id)).data;
      const actorField = fields.find((field) => field.name === 'Actor')!;
      const titleField = fields.find((field) => field.name === 'Title')!;
      const records = (
        await getRecords(importedTable.id, {
          fieldKeyType: FieldKeyType.Id,
          take: rowCount,
          orderBy: [{ fieldId: titleField.id, order: SortFunc.Asc }],
        })
      ).records;
      expect(records[0]!.fields[actorField.id]).toMatchObject({
        id: targetBaseMember.id,
        title: targetBaseMember.name,
        email: targetBaseMember.email,
      });
      expect(JSON.stringify(records[0]!.fields[actorField.id])).not.toContain('forged');
    } finally {
      lookupSpy.mockRestore();
      await prisma.collaborator.deleteMany({ where: { id: collaboratorId } });
    }
  }, 30_000);

  it('accepts direct and child department members scoped through the target space', async (ctx) => {
    if (!hasOrgTables) ctx.skip();
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = JSON.stringify({
        id: directDepartmentMember.id,
        title: 'forged direct department member',
      });
      data.rows[1]![actorField.dbFieldName] = JSON.stringify({
        id: childDepartmentMember.id,
        title: 'forged child department member',
      });
    });

    expect(await importArchive(archive)).toBeUndefined();
    const importedBaseId = await waitForImportedBaseId();
    const importedTable = (await getTableList(importedBaseId)).data.find(
      (table) => table.name === 'Scoped Users'
    )!;
    const fields = (await getFields(importedTable.id)).data;
    const actorField = fields.find((field) => field.name === 'Actor')!;
    const titleField = fields.find((field) => field.name === 'Title')!;
    const records = (
      await getRecords(importedTable.id, {
        fieldKeyType: FieldKeyType.Id,
        take: rowCount,
        orderBy: [{ fieldId: titleField.id, order: SortFunc.Asc }],
      })
    ).records;
    expect(records[0]!.fields[actorField.id]).toMatchObject({
      id: directDepartmentMember.id,
      title: directDepartmentMember.name,
      email: directDepartmentMember.email,
    });
    expect(records[1]!.fields[actorField.id]).toMatchObject({
      id: childDepartmentMember.id,
      title: childDepartmentMember.name,
      email: childDepartmentMember.email,
    });
    expect(JSON.stringify([records[0]!.fields, records[1]!.fields])).not.toContain('forged');
  }, 30_000);

  it('fails closed without restoring rows when the scoped lookup returns an error', async () => {
    const archive = await repackTableCsv(sourceArchive, patchValidIdentities);
    const lookupSpy = vi
      .spyOn(PostgresUserLookupService.prototype, 'listTableUsersByIdentifiers')
      .mockImplementationOnce(async () =>
        err(domainError.infrastructure({ message: 'Injected table-user lookup failure' }))
      );

    try {
      const error = await importArchive(archive);
      expect(error?.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(error)).not.toContain(actorId);
      expect(JSON.stringify(error)).not.toContain(actorEmail);
      const importedBaseId = await waitForImportedBaseId();
      const importedTable = (await getTableList(importedBaseId)).data.find(
        (table) => table.name === 'Scoped Users'
      )!;
      expect(
        (await getRecords(importedTable.id, { fieldKeyType: FieldKeyType.Id, take: rowCount }))
          .records
      ).toHaveLength(0);
    } finally {
      lookupSpy.mockRestore();
    }
  }, 30_000);

  it('restores both batches and clears only the later outsider cell with a warning', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const memberField = data.table.fields.find((field) => field.name === 'Space Member')!;
      data.rows[committedBatchSize]![memberField.dbFieldName] = JSON.stringify({
        id: sourceOnlyMember.id,
        title: 'LATE LEAKED OUTSIDER',
      });
    });

    const { records, fieldByName } = await assertSkippedUserCell(
      archive,
      [sourceOnlyMember.id, sourceOnlyEmail, 'LATE LEAKED OUTSIDER'],
      committedBatchSize,
      'Space Member'
    );
    expect(records[committedBatchSize - 1]!.fields[fieldByName('Space Member').id]).toMatchObject({
      id: spaceMember.id,
      title: spaceMember.name,
      email: spaceMember.email,
    });
  }, 30_000);

  it('rechecks each batch and clears revoked cells while replacing revoked attribution with the importer', async () => {
    const archive = await repackTableCsv(sourceArchive, patchValidIdentities);
    const original = PostgresUserLookupService.prototype.listTableUsersByIdentifiers;
    let lookupCount = 0;
    let revoked = false;
    const lookupSpy = vi
      .spyOn(PostgresUserLookupService.prototype, 'listTableUsersByIdentifiers')
      .mockImplementation(async function (tableId, identifiers) {
        lookupCount += 1;
        if (lookupCount === 2) {
          await prisma.collaborator.deleteMany({
            where: {
              resourceId: spaceId,
              principalId: spaceMember.id,
              principalType: PrincipalType.User,
            },
          });
          revoked = true;
        }
        return original.call(this, tableId, identifiers);
      });

    try {
      expect(await importArchive(archive)).toBeUndefined();
      expect(lookupCount).toBe(2);
      const baseId = await waitForImportedBaseId();
      const { records, fieldByName } = await getImportedRows(baseId);
      expect(records[0]!.fields[fieldByName('Space Member').id]).toMatchObject({
        id: spaceMember.id,
        title: spaceMember.name,
        email: spaceMember.email,
      });
      expect(records[0]!.fields[fieldByName('Last Modified By').id]).toMatchObject({
        id: spaceMember.id,
        title: spaceMember.name,
      });
      for (const [index, record] of records.entries()) {
        if (index < committedBatchSize) continue;
        expect(record.fields[fieldByName('Space Member').id] ?? null).toBeNull();
        if (index % 4 === 1) {
          expect(record.fields[fieldByName('Created By').id]).toMatchObject({
            id: actorId,
            title: actorName,
          });
        }
        if (index % 4 === 0) {
          expect(record.fields[fieldByName('Last Modified By').id]).toMatchObject({
            id: actorId,
            title: actorName,
          });
        }
        expect(JSON.stringify(record)).not.toContain(spaceMember.id);
        expect(JSON.stringify(record)).not.toContain(spaceMember.email);
      }
      const remainingRows = rowCount - committedBatchSize;
      await assertImportWarning(baseId, remainingRows + remainingRows / 2, [
        spaceMember.id,
        spaceMember.email,
      ]);
    } finally {
      lookupSpy.mockRestore();
      if (revoked) {
        await emailSpaceInvitation({
          spaceId,
          emailSpaceInvitationRo: { emails: [spaceMemberEmail], role: Role.Editor },
        });
      }
    }
  }, 30_000);
});
