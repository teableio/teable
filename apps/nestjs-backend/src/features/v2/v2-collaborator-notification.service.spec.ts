import { FieldType } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import {
  BaseId,
  domainError,
  err,
  ok,
  FieldId,
  FieldName,
  type ListTableRecordsQuery,
  ListTableRecordsResult,
  NumberFormatting,
  Table,
  TableId,
  TableName,
  type Table as V2Table,
  type TableRecordReadModel,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { DatabaseRouter } from '../../global/database-router.service';

vi.mock('../notification/notification.service', () => ({
  maxCollaboratorNotifyRecordTitles: 10,
  NotificationService: class NotificationService {},
}));

vi.mock('./v2-container.service', () => ({
  V2ContainerService: class V2ContainerService {},
}));

import { RecordTitleReader } from './record-title-reader';
import {
  V2CollaboratorNotificationDispatcher,
  V2RecordsBatchCreatedCollaboratorNotificationProjection,
  V2RecordsBatchUpdatedCollaboratorNotificationProjection,
  V2RecordCreatedCollaboratorNotificationProjection,
  V2RecordUpdatedCollaboratorNotificationProjection,
} from './v2-collaborator-notification.service';

const createScheduledContext = (options?: { undoRedoMode?: 'undo' | 'redo' | 'normal' }) => {
  const scheduled: Array<() => Promise<void> | void> = [];
  const context = {
    actorId: { toString: () => 'usrActor000000001' },
    ...(options?.undoRedoMode ? { undoRedo: { mode: options.undoRedoMode } } : {}),
    scheduleBackgroundTask: vi.fn((task: () => Promise<void> | void) => {
      scheduled.push(task);
    }),
  };
  return { context, scheduled };
};

const flushScheduled = async (scheduled: Array<() => Promise<void> | void>) => {
  while (scheduled.length) {
    await scheduled.shift()?.();
  }
};

const createV2ContainerService = () => {
  const userFieldsQuery = {
    innerJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([
      {
        baseId: 'bseNotify000000001',
        tableName: 'Tasks',
        fieldId: 'fldAssignee0000001',
        fieldName: 'Assignee',
        fieldOptions: JSON.stringify({ shouldNotify: true }),
      },
      {
        baseId: 'bseNotify000000001',
        tableName: 'Tasks',
        fieldId: 'fldMuted000000001',
        fieldName: 'Muted',
        fieldOptions: JSON.stringify({ shouldNotify: false }),
      },
      {
        baseId: 'bseNotify000000001',
        tableName: 'Tasks',
        fieldId: 'fldReviewer0000001',
        fieldName: 'Reviewer',
        fieldOptions: JSON.stringify({ shouldNotify: true }),
      },
    ]),
  };
  const db = {
    selectFrom: vi.fn().mockReturnValue(userFieldsQuery),
  };

  return {
    db,
    service: {
      getContainer: vi.fn().mockResolvedValue({
        resolve: vi.fn().mockReturnValue(db),
      }),
    },
  };
};

const createCollaboratorService = () => ({
  getUserCollaboratorsByTableId: vi.fn(
    async (_tableId: string, query: { containsIn: { values: string[] } }) =>
      query.containsIn.values.map((id) => ({ id }))
  ),
});
const createDispatcher = (recordTitleFixture?: {
  table: V2Table;
  records: TableRecordReadModel[];
  failedRecordId?: string;
}) => {
  const { db, service: v2ContainerService } = createV2ContainerService();
  const collaboratorService = createCollaboratorService();
  const notificationService = {
    sendCollaboratorNotify: vi.fn().mockResolvedValue(true),
  };
  const reader = recordTitleFixture
    ? new RecordTitleReader(
        {
          getContainerForTable: async () => ({
            resolve: () => ({
              findOne: async () => ({ isErr: () => false, value: recordTitleFixture.table }),
              execute: async (_ctx: unknown, query: ListTableRecordsQuery) => {
                const selected = new Set(query.selectedRecordIds);
                if (recordTitleFixture.failedRecordId && selected.has(recordTitleFixture.failedRecordId)) {
                  return err(domainError.infrastructure({ message: 'Title page unavailable' }));
                }
                const records = recordTitleFixture.records
                  .filter(({ id }) => selected.has(id))
                  .slice(0, query.pagination.limit().toNumber());
                return {
                  isErr: () => false,
                  value: ListTableRecordsResult.create(records, records.length, 0, records.length),
                };
              },
            }),
          }),
        } as never,
        { createContext: async () => ({}) } as never,
        mockDeep<PrismaService>(),
        mockDeep<DatabaseRouter>()
      )
    : { tryByIds: vi.fn().mockResolvedValue(ok([])) };
  const dispatcher = new V2CollaboratorNotificationDispatcher(
    v2ContainerService as never,
    notificationService as never,
    reader as RecordTitleReader,
    collaboratorService as never
  );

  return { db, dispatcher, notificationService, collaboratorService, reader };
};

describe('V2CollaboratorNotificationDispatcher', () => {
  it.each([false, true])('delivers available titles across pages (last page fails: %s)', async (failLastPage) => {
    const tableId = `tbl${'t'.repeat(16)}`;
    const primaryFieldId = `fld${'p'.repeat(16)}`;
    const table = Table.builder()
      .withId(TableId.create(tableId)._unsafeUnwrap())
      .withBaseId(BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Tasks')._unsafeUnwrap())
      .field()
      .number()
      .withId(FieldId.create(primaryFieldId)._unsafeUnwrap())
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .withFormatting(
        NumberFormatting.create({ type: 'currency', precision: 2, symbol: '$' })._unsafeUnwrap()
      )
      .primary()
      .done()
      .view()
      .defaultGrid()
      .done()
      .build()
      ._unsafeUnwrap();
    const records = Array.from({ length: 1002 }, (_, index) => ({
      id: `rec${String(index).padStart(16, '0')}`,
      fields: { [primaryFieldId]: index + 0.5 },
      version: 1,
      autoNumber: index + 1,
      createdTime: '2026-01-01T00:00:00.000Z',
      createdByActorId: null,
      createdByActorType: null,
      lastModifiedByActorId: null,
      lastModifiedByActorType: null,
    }));
    const { dispatcher, notificationService } = createDispatcher({
      table,
      records: [...records].reverse(),
      failedRecordId: failLastPage ? records[1000]!.id : undefined,
    });

    await dispatcher.notifyUserFields({
      actorId: 'usrActor000000001',
      tableId,
      records: records.map(({ id }, index) => ({
        id,
        fields: { fldAssignee0000001: { id: `usrTeam${Math.floor(index / 10)}`, title: 'Team' } },
      })),
    });

    const firstRecipientRecords = records.slice(0, 10);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        toUserId: 'usrTeam0',
        refRecord: expect.objectContaining({
          recordIds: firstRecipientRecords.map(({ id }) => id),
          recordTitles: firstRecipientRecords.map(({ id }, index) => ({ id, title: `$${index}.50` })),
        }),
      })
    );
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        toUserId: 'usrTeam100',
        refRecord: expect.objectContaining({
          recordIds: [records[1000]!.id, records[1001]!.id],
          recordTitles: failLastPage ? [] : [
            { id: records[1000]!.id, title: '$1,000.50' },
            { id: records[1001]!.id, title: '$1,001.50' },
          ],
        }),
      })
    );
  });

  it('delivers v2 created record IDs when the title query returns a domain error', async () => {
    const { dispatcher, notificationService, reader } = createDispatcher();
    vi.spyOn(reader, 'tryByIds').mockResolvedValue(err(domainError.notFound({ message: 'Missing table' })));
    const projection = new V2RecordCreatedCollaboratorNotificationProjection(dispatcher);
    const { context, scheduled } = createScheduledContext();

    const result = await projection.handle(
      context as never,
      {
        source: { type: 'user' },
        tableId: { toString: () => 'tblNotify00000001' },
        recordId: { toString: () => 'recNotify00000001' },
        fieldValues: [
          {
            fieldId: 'fldAssignee0000001',
            value: { id: 'usrTarget00000001', title: 'Target', email: 'target@example.com' },
          },
        ],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();

    await flushScheduled(scheduled);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith({
      fromUserId: 'usrActor000000001',
      toUserId: 'usrTarget00000001',
      refRecord: {
        baseId: 'bseNotify000000001',
        tableId: 'tblNotify00000001',
        tableName: 'Tasks',
        fieldName: 'Assignee',
        recordIds: ['recNotify00000001'],
        recordTitles: [],
      },
    });
  });

  it('sends collaborator notification for v2 updated records with notified user field changes', async () => {
    const { dispatcher, notificationService } = createDispatcher();
    const projection = new V2RecordUpdatedCollaboratorNotificationProjection(dispatcher);
    const { context, scheduled } = createScheduledContext();

    const result = await projection.handle(
      context as never,
      {
        source: 'user',
        tableId: { toString: () => 'tblNotify00000001' },
        recordId: { toString: () => 'recNotify00000001' },
        changes: [
          {
            fieldId: 'fldMuted000000001',
            oldValue: null,
            newValue: { id: 'usrMuted000000001', title: 'Muted' },
          },
          {
            fieldId: 'fldAssignee0000001',
            oldValue: null,
            newValue: [{ id: 'usrTarget00000001', title: 'Target' }],
          },
        ],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();

    await flushScheduled(scheduled);

    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        fromUserId: 'usrActor000000001',
        toUserId: 'usrTarget00000001',
      })
    );
  });

  it.each([
    ['computed source', 'computed', undefined],
    ['undo replay', 'user', 'undo'],
    ['redo replay', 'user', 'redo'],
  ] as const)('ignores non-user v2 update events (%s)', async (_label, source, undoRedoMode) => {
    const { dispatcher, notificationService } = createDispatcher();
    const projection = new V2RecordUpdatedCollaboratorNotificationProjection(dispatcher);
    const { context, scheduled } = createScheduledContext(
      undoRedoMode ? { undoRedoMode } : undefined
    );

    const result = await projection.handle(
      context as never,
      {
        source,
        tableId: { toString: () => 'tblNotify00000001' },
        recordId: { toString: () => 'recNotify00000001' },
        changes: [
          {
            fieldId: 'fldAssignee0000001',
            oldValue: null,
            newValue: { id: 'usrTarget00000001', title: 'Target' },
          },
        ],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(scheduled).toHaveLength(0);
    expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();
  });

  it('notifies only recipients that can access the destination table', async () => {
    const tableId = 'tblNotify00000001';
    const recordId = 'recNotify00000001';
    const { dispatcher, notificationService, collaboratorService } = createDispatcher();
    collaboratorService.getUserCollaboratorsByTableId.mockResolvedValue([
      { id: 'usrCollaborator00001' },
    ]);

    await dispatcher.notifyUserFields({
      actorId: 'usrActor000000001',
      tableId,
      records: [
        {
          id: recordId,
          fields: {
            fldAssignee0000001: [
              { id: 'usrOutsider00000001', email: 'outsider@example.com' },
              { id: 'usrCollaborator00001', email: 'member@example.com' },
            ],
          },
        },
      ],
    });

    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({ toUserId: 'usrCollaborator00001' })
    );
  });

  it('skips the notification run when no recipient can access the destination table', async () => {
    const tableId = 'tblNotify00000001';
    const { dispatcher, notificationService, collaboratorService } = createDispatcher();
    collaboratorService.getUserCollaboratorsByTableId.mockResolvedValue([]);

    await dispatcher.notifyUserFields({
      actorId: 'usrActor000000001',
      tableId,
      records: [
        {
          id: 'recNotify00000001',
          fields: {
            fldAssignee0000001: { id: 'usrOutsider00000001', email: 'outsider@example.com' },
          },
        },
      ],
    });

    expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();
  });
});

describe('V2RecordsBatchUpdatedCollaboratorNotificationProjection', () => {
  it('does not schedule or query for an all-clear batch', async () => {
    const { db, dispatcher, notificationService } = createDispatcher();
    const projection = new V2RecordsBatchUpdatedCollaboratorNotificationProjection(dispatcher);
    const { context, scheduled } = createScheduledContext();

    const result = await projection.handle(
      context as never,
      {
        source: 'user',
        tableId: { toString: () => 'tblNotify00000001' },
        updates: [
          {
            recordId: 'recNotify00000001',
            changes: [
              {
                fieldId: 'fldAssignee0000001',
                oldValue: { id: 'usrTarget00000001', title: 'Target' },
                newValue: null,
              },
            ],
          },
        ],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(scheduled).toHaveLength(0);
    expect(db.selectFrom).not.toHaveBeenCalled();
    expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();
  });

  it.each([
    ['single object', { id: 'usrTarget00000001', title: 'Target' }],
    ['array', [{ id: 'usrTarget00000001', title: 'Target' }]],
  ])('schedules once for a valid %s user candidate', async (_label, newValue) => {
    const { db, dispatcher, notificationService } = createDispatcher();
    const projection = new V2RecordsBatchUpdatedCollaboratorNotificationProjection(dispatcher);
    const { context, scheduled } = createScheduledContext();

    const result = await projection.handle(
      context as never,
      {
        source: 'user',
        tableId: { toString: () => 'tblNotify00000001' },
        updates: [
          {
            recordId: 'recNotify00000001',
            changes: [
              {
                fieldId: 'fldAssignee0000001',
                oldValue: null,
                newValue,
              },
            ],
          },
        ],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(scheduled).toHaveLength(1);
    expect(db.selectFrom).not.toHaveBeenCalled();

    await flushScheduled(scheduled);

    expect(db.selectFrom).toHaveBeenCalledTimes(1);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['computed source', 'computed', undefined],
    ['undo replay', 'user', 'undo'],
    ['redo replay', 'user', 'redo'],
  ] as const)(
    'does not schedule %s batches even when they contain a user candidate',
    async (_label, source, undoRedoMode) => {
      const { db, dispatcher, notificationService } = createDispatcher();
      const projection = new V2RecordsBatchUpdatedCollaboratorNotificationProjection(dispatcher);
      const { context, scheduled } = createScheduledContext(
        undoRedoMode ? { undoRedoMode } : undefined
      );

      const result = await projection.handle(
        context as never,
        {
          source,
          tableId: { toString: () => 'tblNotify00000001' },
          updates: [
            {
              recordId: 'recNotify00000001',
              changes: [
                {
                  fieldId: 'fldAssignee0000001',
                  oldValue: null,
                  newValue: { id: 'usrTarget00000001', title: 'Target' },
                },
              ],
            },
          ],
        } as never
      );

      expect(result._unsafeUnwrap()).toBeUndefined();
      expect(scheduled).toHaveLength(0);
      expect(db.selectFrom).not.toHaveBeenCalled();
      expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();
    }
  );
});

describe('V2 create projections skip assignment-movement sources (T6662)', () => {
  const userFieldValues = [
    {
      fieldId: 'fldAssignee0000001',
      value: { id: 'usrTarget00000001', title: 'Target', email: 'target@example.com' },
    },
  ];

  it.each([[{ type: 'import' }], [{ type: 'tableDuplicate' }], [{ type: 'restore' }]])(
    'RecordCreated skips source %j',
    async (source) => {
      const { dispatcher, notificationService } = createDispatcher();
      const projection = new V2RecordCreatedCollaboratorNotificationProjection(dispatcher);
      const { context, scheduled } = createScheduledContext();

      const result = await projection.handle(
        context as never,
        {
          source,
          tableId: { toString: () => 'tblNotify00000001' },
          recordId: { toString: () => 'recNotify00000001' },
          fieldValues: userFieldValues,
        } as never
      );

      expect(result._unsafeUnwrap()).toBeUndefined();
      expect(scheduled).toHaveLength(0);
      expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();
    }
  );

  it.each([[{ type: 'import' }], [{ type: 'tableDuplicate' }], [{ type: 'restore' }]])(
    'RecordsBatchCreated skips source %j',
    async (source) => {
      const { dispatcher, notificationService } = createDispatcher();
      const projection = new V2RecordsBatchCreatedCollaboratorNotificationProjection(dispatcher);
      const { context, scheduled } = createScheduledContext();

      const result = await projection.handle(
        context as never,
        {
          source,
          tableId: { toString: () => 'tblNotify00000001' },
          records: [{ recordId: 'recNotify00000001', fields: userFieldValues }],
        } as never
      );

      expect(result._unsafeUnwrap()).toBeUndefined();
      expect(scheduled).toHaveLength(0);
      expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();
    }
  );

  // T7798 / Q2-15: duplicating a record is an ordinary create for notification
  // purposes, so the copied assignee is notified.
  type CreateNotificationProjection =
    | V2RecordCreatedCollaboratorNotificationProjection
    | V2RecordsBatchCreatedCollaboratorNotificationProjection;

  const expectRecordDuplicateNotifies = async (projection: CreateNotificationProjection) => {
    const { context, scheduled } = createScheduledContext();

    const result = await projection.handle(
      context as never,
      {
        source: { type: 'recordDuplicate' },
        tableId: { toString: () => 'tblNotify00000001' },
        recordId: { toString: () => 'recNotify00000001' },
        records: [{ recordId: 'recNotify00000001', fields: userFieldValues }],
        fieldValues: userFieldValues,
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(scheduled).toHaveLength(1);

    await flushScheduled(scheduled);
  };

  it('notifies for recordDuplicate source on RecordCreated', async () => {
    const { dispatcher, notificationService } = createDispatcher();
    await expectRecordDuplicateNotifies(
      new V2RecordCreatedCollaboratorNotificationProjection(dispatcher)
    );

    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        fromUserId: 'usrActor000000001',
        toUserId: 'usrTarget00000001',
      })
    );
  });

  it('notifies for recordDuplicate source on RecordsBatchCreated', async () => {
    const { dispatcher, notificationService } = createDispatcher();
    await expectRecordDuplicateNotifies(
      new V2RecordsBatchCreatedCollaboratorNotificationProjection(dispatcher)
    );

    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        fromUserId: 'usrActor000000001',
        toUserId: 'usrTarget00000001',
      })
    );
  });

  it('RecordsBatchCreated still notifies for form submissions', async () => {
    const { dispatcher, notificationService } = createDispatcher();
    const projection = new V2RecordsBatchCreatedCollaboratorNotificationProjection(dispatcher);
    const { context, scheduled } = createScheduledContext();

    const result = await projection.handle(
      context as never,
      {
        source: { type: 'form', formId: 'frmNotify00000001' },
        tableId: { toString: () => 'tblNotify00000001' },
        records: [{ recordId: 'recNotify00000001', fields: userFieldValues }],
      } as never
    );

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(scheduled).toHaveLength(1);

    await flushScheduled(scheduled);

    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        fromUserId: 'usrActor000000001',
        toUserId: 'usrTarget00000001',
      })
    );
  });
});

describe('v2 collaborator notification field filtering', () => {});
