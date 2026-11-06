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
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createAwaitWithEventWithResult } from './utils/event-promise';
import { getError } from './utils/get-error';
import {
  createBase,
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

  const assertScopedRejection = async (
    archiveBytes: Buffer,
    forbiddenValues: string[],
    expectedDomainCode = 'validation.field.user_not_found'
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
    await prisma.collaborator.deleteMany({ where: { id: departmentCollaboratorId } });
    await prisma.$executeRaw`delete from organization where id = ${organizationId}`;
    await app?.close();
  }, 30_000);

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

  it('rejects a bare outsider id before restoring its first batch', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = JSON.stringify({ id: sourceOnlyMember.id });
    });
    await assertScopedRejection(archive, [sourceOnlyMember.id, sourceOnlyEmail]);
  }, 30_000);

  it('rejects a mismatched pair even when its id is a target collaborator', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = userCell(actorId, 'FORGED PAIR', sourceOnlyEmail);
    });
    await assertScopedRejection(archive, [actorId, actorEmail, sourceOnlyEmail, 'FORGED PAIR']);
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
      await assertScopedRejection(archive, [sourceOnlyMember.id, sourceOnlyEmail]);
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
      await assertScopedRejection(archive, [sourceOnlyMember.id, sourceOnlyEmail]);
    },
    30_000
  );

  it('rejects an unknown creator before restoring its first batch', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      data.rows[0]!.__created_by = 'usrUnknownTeaImport';
    });

    await assertScopedRejection(archive, ['usrUnknownTeaImport']);
  }, 30_000);

  it('rejects a source-base-only system user spoofed as the last modifier', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      data.rows[0]!.__last_modified_by = systemSpoof.id;
    });

    await assertScopedRejection(archive, [systemSpoof.id, systemSpoofEmail]);
  }, 30_000);

  it('rejects an unknown id in an editable user cell before restoring its first batch', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const actorField = data.table.fields.find((field) => field.name === 'Actor')!;
      data.rows[0]![actorField.dbFieldName] = userCell(
        'usrUnknownEditableUser',
        'UNKNOWN EDITABLE USER',
        'unknown-editable@example.com'
      );
    });

    await assertScopedRejection(archive, [
      'usrUnknownEditableUser',
      'UNKNOWN EDITABLE USER',
      'unknown-editable@example.com',
    ]);
  }, 30_000);

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

  it('accepts direct and child department members scoped through the target space', async () => {
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

  it('keeps an earlier committed batch but rejects the later batch containing an outsider', async () => {
    const archive = await repackTableCsv(sourceArchive, (data) => {
      patchValidIdentities(data);
      const memberField = data.table.fields.find((field) => field.name === 'Space Member')!;
      data.rows[committedBatchSize]![memberField.dbFieldName] = JSON.stringify({
        id: sourceOnlyMember.id,
        title: 'LATE LEAKED OUTSIDER',
      });
    });

    const error = await importArchive(archive);
    expect(error?.status).toBeGreaterThanOrEqual(400);
    expect(error?.status).toBeLessThan(500);
    expect(error?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
    expect(JSON.stringify(error).toLowerCase()).not.toContain(sourceOnlyEmail.toLowerCase());
    expect(JSON.stringify(error)).not.toContain('LATE LEAKED OUTSIDER');
    expect(JSON.stringify(error)).not.toContain(sourceOnlyMember.id);
    expect((error?.data as { domainCode?: string } | undefined)?.domainCode).toBe(
      'validation.field.user_not_found'
    );

    const importedBaseId = await waitForImportedBaseId();
    const importedTable = (await getTableList(importedBaseId)).data.find(
      (table) => table.name === 'Scoped Users'
    )!;
    const records = await getRecords(importedTable.id, {
      fieldKeyType: FieldKeyType.Id,
      take: rowCount,
    });
    expect(records.records).toHaveLength(committedBatchSize);
    expect(JSON.stringify(records.records)).not.toContain(sourceOnlyMember.id);
  }, 30_000);

  it('rechecks scope for each batch and rejects the next batch after grant revocation', async () => {
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
      const error = await importArchive(archive);
      expect(lookupCount).toBe(2);
      expect(error?.status).toBeGreaterThanOrEqual(400);
      expect(error?.status).toBeLessThan(500);
      expect(error?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
      expect((error?.data as { domainCode?: string } | undefined)?.domainCode).toBe(
        'validation.field.user_not_found'
      );
      expect(JSON.stringify(error)).not.toContain(spaceMember.id);
      expect(JSON.stringify(error)).not.toContain(spaceMember.email);

      const importedBaseId = await waitForImportedBaseId();
      const importedTable = (await getTableList(importedBaseId)).data.find(
        (table) => table.name === 'Scoped Users'
      )!;
      const records = await getRecords(importedTable.id, {
        fieldKeyType: FieldKeyType.Id,
        take: rowCount,
      });
      expect(records.records).toHaveLength(committedBatchSize);
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
