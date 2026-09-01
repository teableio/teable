/* eslint-disable @typescript-eslint/naming-convention */
import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  getRandomString,
  NotificationTypeEnum,
  Relationship,
  Role as baseRole,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IUserMeVo } from '@teable/openapi';
import {
  duplicateTable as apiDuplicateTable,
  emailBaseInvitation,
  ensureUndoRedoWindowIdHeader,
  getSignature as apiGetSignature,
  getTrashItems,
  inplaceImportTableFromFile as apiInplaceImportTableFromFile,
  notify as apiNotify,
  redo,
  restoreTrash,
  TrashType,
  undo,
  uploadFile as apiUploadFile,
  SUPPORTEDTYPE,
  UploadType,
  USER_ME,
} from '@teable/openapi';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { CsvImporter } from '../src/features/import/open-api/import.class';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  createField,
  createRecords,
  createTable,
  deleteRecords,
  duplicateRecord,
  getFields,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

/**
 * T6662: user-field collaborator notifications must only fire when
 * someone actively assigns a user right now. Paths that move existing
 * assignments around — CSV import into an existing table, table duplicate,
 * record duplicate, trash restore, undo/redo replay — stay silent.
 *
 * All requests run with FORCE_V2_ALL=true so they route through the v2
 * command handlers that publish record events with sources
 * 'import' / 'tableDuplicate' / 'recordDuplicate' / 'restore'; replayed
 * updates are silenced via the undo/redo execution context.
 */
const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

describe('V2 user field notification on bulk actions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assignee: IUserMeVo;
  let previousForceV2All: string | undefined;

  const baseId = globalThis.testConfig.baseId;
  const actorId = globalThis.testConfig.userId;
  const xTeableV2Header = 'x-teable-v2';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);

    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';

    // Undo/redo entries are only captured for requests carrying a window id.
    ensureUndoRedoWindowIdHeader('win' + getRandomString(8));

    const assigneeEmail = `v2-bulk-notify-${Date.now()}@example.com`;
    const assigneeAxios = await createNewUserAxios({
      email: assigneeEmail,
      password: '12345678',
    });
    assignee = (await assigneeAxios.get<IUserMeVo>(USER_ME)).data;

    await emailBaseInvitation({
      baseId,
      emailBaseInvitationRo: {
        emails: [assigneeEmail],
        role: baseRole.Editor,
      },
    });
  });

  afterAll(async () => {
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    await app.close();
  });

  const createUserFieldTable = async (name: string) => {
    const table = await createTable(baseId, {
      name,
      fields: [
        { name: 'Title', type: FieldType.SingleLineText, isPrimary: true },
        {
          name: 'Assignee',
          type: FieldType.User,
          options: {
            isMultiple: false,
            shouldNotify: true,
          },
        },
      ],
    });
    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const assigneeFieldId = table.fields.find((field) => field.name === 'Assignee')?.id ?? '';
    return { table, titleFieldId, assigneeFieldId };
  };

  const clearNotifications = async (tableId: string) => {
    await prisma.notification.deleteMany({
      where: {
        fromUserId: actorId,
        toUserId: assignee.id,
        urlPath: { contains: tableId },
      },
    });
  };

  const waitForCollaboratorNotification = async (params: {
    tableId: string;
    timeoutMs?: number;
  }) => {
    const { tableId, timeoutMs = 8000 } = params;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const notification = await prisma.notification.findFirst({
        where: {
          fromUserId: actorId,
          toUserId: assignee.id,
          type: NotificationTypeEnum.CollaboratorCellTag,
          urlPath: { contains: tableId },
        },
        orderBy: { createdTime: 'desc' },
      });

      if (notification) {
        return notification;
      }

      await sleep(100);
    }

    return null;
  };

  it('sends collaborator notification on manual record create (control)', async () => {
    const { table, titleFieldId, assigneeFieldId } =
      await createUserFieldTable('v2 bulk notify control');

    try {
      await clearNotifications(table.id);

      const { records } = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'manual create',
              [assigneeFieldId]: {
                id: assignee.id,
                title: assignee.name,
                email: assignee.email,
              },
            },
          },
        ],
      });
      expect(records).toHaveLength(1);

      const notification = await waitForCollaboratorNotification({ tableId: table.id });
      expect(notification).toMatchObject({
        fromUserId: actorId,
        toUserId: assignee.id,
        type: NotificationTypeEnum.CollaboratorCellTag,
      });
    } finally {
      await clearNotifications(table.id);
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it(
    'does not send collaborator notification on CSV inplace import',
    { timeout: 60000 },
    async () => {
      const { table, titleFieldId, assigneeFieldId } =
        await createUserFieldTable('v2 bulk notify import');

      try {
        await clearNotifications(table.id);

        const csvData = `Title,Assignee\nimported row,${assignee.email}\n`;
        const tmpPath = path.resolve(
          path.join(StorageAdapter.TEMPORARY_DIR, `v2-bulk-notify-${Date.now()}.csv`)
        );
        fs.writeFileSync(tmpPath, csvData);

        const file = fs.createReadStream(tmpPath);
        const stats = fs.statSync(tmpPath);
        const { token, requestHeaders } = (
          await apiGetSignature(
            {
              type: UploadType.Import,
              contentLength: stats.size,
              contentType: 'text/csv',
            },
            undefined
          )
        ).data;
        await apiUploadFile(token, file, requestHeaders);
        const {
          data: { presignedUrl },
        } = await apiNotify(token, undefined, 'v2-bulk-notify.csv');

        const sourceColumnMap: Record<string, number> = {
          [titleFieldId]: 0,
          [assigneeFieldId]: 1,
        };

        const importRes = await apiInplaceImportTableFromFile(baseId, table.id, {
          attachmentUrl: presignedUrl,
          fileType: SUPPORTEDTYPE.CSV,
          insertConfig: {
            sourceWorkSheetKey: CsvImporter.DEFAULT_SHEETKEY,
            excludeFirstRow: true,
            sourceColumnMap,
          },
        });
        // Guard: the assertion below is only meaningful on the v2 import path.
        expect(importRes.headers[xTeableV2Header]).toBe('true');

        // Wait until the imported row is visible, including the resolved user value.
        const deadline = Date.now() + 30000;
        let imported: IRecord[] = [];
        while (Date.now() < deadline) {
          const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
          imported = records.filter((record) => record.fields[titleFieldId] === 'imported row');
          if (imported.length > 0) {
            break;
          }
          await sleep(200);
        }
        expect(imported).toHaveLength(1);
        const assigneeValue = imported[0].fields[assigneeFieldId] as
          | { id?: string }
          | { id?: string }[]
          | undefined;
        const assigneeIds = (Array.isArray(assigneeValue) ? assigneeValue : [assigneeValue])
          .filter(Boolean)
          .map((value) => value?.id);
        expect(assigneeIds).toContain(assignee.id);

        const notification = await waitForCollaboratorNotification({ tableId: table.id });
        expect(notification).toBeNull();
      } finally {
        await clearNotifications(table.id);
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );

  it('does not send collaborator notification on table duplicate', { timeout: 60000 }, async () => {
    const { table, titleFieldId, assigneeFieldId } = await createUserFieldTable(
      'v2 bulk notify duplicate'
    );
    // A two-way oneMany link hosts its FK on the foreign table, which the
    // physical row-copy plan cannot map; v2 duplicate then takes the hydrated
    // record path that publishes full RecordsBatchCreated field values.
    const foreignTable = await createTable(baseId, {
      name: 'v2 bulk notify duplicate foreign',
      fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true }],
    });

    let duplicatedTableId: string | undefined;
    try {
      await createField(table.id, {
        name: 'LinkToForeign',
        type: FieldType.Link,
        options: {
          foreignTableId: foreignTable.id,
          relationship: Relationship.OneMany,
        },
      });

      const { records } = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'duplicated row',
              [assigneeFieldId]: {
                id: assignee.id,
                title: assignee.name,
                email: assignee.email,
              },
            },
          },
        ],
      });
      expect(records).toHaveLength(1);

      // The manual create above notifies on the SOURCE table id only; the
      // negative assertion below is scoped to the duplicated table id.
      const duplicateRes = await apiDuplicateTable(baseId, table.id, {
        name: 'v2 bulk notify duplicate copy',
        includeRecords: true,
      });
      // Guard: the assertion below is only meaningful on the v2 duplicate path.
      expect(duplicateRes.headers[xTeableV2Header]).toBe('true');

      duplicatedTableId = duplicateRes.data.id;
      expect(duplicatedTableId).toBeTruthy();

      // Field ids are remapped in the duplicated table; resolve them by name.
      const duplicatedFields = await getFields(duplicatedTableId);
      const duplicatedTitleFieldId =
        duplicatedFields.find((field) => field.name === 'Title')?.id ?? '';
      const duplicatedAssigneeFieldId =
        duplicatedFields.find((field) => field.name === 'Assignee')?.id ?? '';
      expect(duplicatedTitleFieldId).toBeTruthy();
      expect(duplicatedAssigneeFieldId).toBeTruthy();

      // Wait until the duplicated record is visible with the user value copied.
      const deadline = Date.now() + 30000;
      let copied: IRecord[] = [];
      while (Date.now() < deadline) {
        if (duplicatedTableId) {
          const { records: duplicatedRecords } = await getRecords(duplicatedTableId, {
            fieldKeyType: FieldKeyType.Id,
          });
          copied = duplicatedRecords.filter(
            (record) => record.fields[duplicatedTitleFieldId] === 'duplicated row'
          );
          if (copied.length > 0) {
            break;
          }
        }
        await sleep(200);
      }
      expect(copied).toHaveLength(1);
      const copiedAssignee = copied[0].fields[duplicatedAssigneeFieldId] as
        | { id?: string }
        | { id?: string }[]
        | undefined;
      const copiedAssigneeIds = (Array.isArray(copiedAssignee) ? copiedAssignee : [copiedAssignee])
        .filter(Boolean)
        .map((value) => value?.id);
      expect(copiedAssigneeIds).toContain(assignee.id);

      const notification = await waitForCollaboratorNotification({
        tableId: duplicatedTableId!,
      });
      expect(notification).toBeNull();
    } finally {
      // The oneMany link hosts its FK on the foreign table, so the foreign
      // table must be dropped before tables its __fk columns reference.
      await permanentDeleteTable(baseId, foreignTable.id);
      if (duplicatedTableId) {
        await clearNotifications(duplicatedTableId);
        await permanentDeleteTable(baseId, duplicatedTableId);
      }
      await clearNotifications(table.id);
      await permanentDeleteTable(baseId, table.id);
    }
  });

  // Creates a record with the assignee set, waits for the create notification
  // (the control behavior) and drops it, so later assertions only see
  // notifications produced by the action under test.
  const createAssignedRecord = async (
    tableId: string,
    titleFieldId: string,
    assigneeFieldId: string,
    title: string
  ) => {
    const { records } = await createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [titleFieldId]: title,
            [assigneeFieldId]: {
              id: assignee.id,
              title: assignee.name,
              email: assignee.email,
            },
          },
        },
      ],
    });
    expect(records).toHaveLength(1);

    const createNotification = await waitForCollaboratorNotification({ tableId });
    expect(createNotification).not.toBeNull();
    await clearNotifications(tableId);
    return records[0];
  };

  // The new cases below pair a positive control wait (create notification) with
  // an 8s negative wait, which does not fit the local 10s default testTimeout.
  it(
    'does not send collaborator notification on record restore from trash',
    { timeout: 60000 },
    async () => {
      const { table, titleFieldId, assigneeFieldId } =
        await createUserFieldTable('v2 bulk notify restore');

      try {
        const record = await createAssignedRecord(
          table.id,
          titleFieldId,
          assigneeFieldId,
          'restored row'
        );

        await deleteRecords(table.id, [record.id]);

        // Wait for the trash snapshot to land, then restore it.
        let trashId: string | undefined;
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const result = await getTrashItems({
            resourceId: table.id,
            resourceType: TrashType.Table,
          });
          trashId = result.data.trashItems[0]?.id;
          if (trashId) {
            break;
          }
          await sleep(200);
        }
        expect(trashId).toBeTruthy();
        await restoreTrash(trashId!, table.id);

        const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
        expect(records.some((item) => item.id === record.id)).toBe(true);

        const notification = await waitForCollaboratorNotification({ tableId: table.id });
        expect(notification).toBeNull();
      } finally {
        await clearNotifications(table.id);
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );

  it(
    'does not send collaborator notification on undo of delete or redo of create',
    { timeout: 60000 },
    async () => {
      const { table, titleFieldId, assigneeFieldId } = await createUserFieldTable(
        'v2 bulk notify undo redo'
      );

      try {
        const record = await createAssignedRecord(
          table.id,
          titleFieldId,
          assigneeFieldId,
          'undo redo row'
        );

        // Undo the create (deletes the record), then redo it: the redo replays
        // the same assignment and must stay silent.
        expect((await undo(table.id)).data.status).toBe('fulfilled');
        expect((await redo(table.id)).data.status).toBe('fulfilled');

        let notification = await waitForCollaboratorNotification({ tableId: table.id });
        expect(notification).toBeNull();

        // Delete then undo: the restore replays the assignment and must stay silent.
        await deleteRecords(table.id, [record.id]);
        expect((await undo(table.id)).data.status).toBe('fulfilled');

        const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
        expect(records.some((item) => item.id === record.id)).toBe(true);

        notification = await waitForCollaboratorNotification({ tableId: table.id });
        expect(notification).toBeNull();
      } finally {
        await clearNotifications(table.id);
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );

  it(
    'does not send collaborator notification on undo of a user-field update',
    { timeout: 60000 },
    async () => {
      const { table, titleFieldId, assigneeFieldId } = await createUserFieldTable(
        'v2 bulk notify update undo'
      );

      try {
        const record = await createAssignedRecord(
          table.id,
          titleFieldId,
          assigneeFieldId,
          'update undo row'
        );

        // Clear the assignee, then undo: the replay writes the assignee back
        // and must stay silent.
        await updateRecord(table.id, record.id, {
          record: { fields: { [assigneeFieldId]: null } },
          fieldKeyType: FieldKeyType.Id,
        });
        expect((await undo(table.id)).data.status).toBe('fulfilled');

        const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
        const restored = records.find((item) => item.id === record.id);
        const restoredAssignee = restored?.fields[assigneeFieldId] as { id?: string } | undefined;
        expect(restoredAssignee?.id).toBe(assignee.id);

        const notification = await waitForCollaboratorNotification({ tableId: table.id });
        expect(notification).toBeNull();
      } finally {
        await clearNotifications(table.id);
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );

  it(
    'does not send collaborator notification on record duplicate',
    { timeout: 60000 },
    async () => {
      const { table, titleFieldId, assigneeFieldId } = await createUserFieldTable(
        'v2 bulk notify record duplicate'
      );

      try {
        const record = await createAssignedRecord(
          table.id,
          titleFieldId,
          assigneeFieldId,
          'duplicated source row'
        );

        const duplicated = await duplicateRecord(table.id, record.id, {
          viewId: table.views[0].id,
          anchorId: record.id,
          position: 'after',
        });
        expect(duplicated.id).toBeTruthy();

        const duplicatedAssignee = duplicated.fields[assigneeFieldId] as
          | { id?: string }
          | undefined;
        expect(duplicatedAssignee?.id).toBe(assignee.id);

        const notification = await waitForCollaboratorNotification({ tableId: table.id });
        expect(notification).toBeNull();
      } finally {
        await clearNotifications(table.id);
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );
});
