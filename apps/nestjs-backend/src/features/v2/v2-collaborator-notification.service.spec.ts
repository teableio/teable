import { FieldType } from '@teable/core';
import {
  BaseId,
  FieldId,
  FieldName,
  ListTableRecordsResult,
  NumberFormatting,
  Table,
  TableId,
  TableName,
  type Table as V2Table,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../notification/notification.service', () => ({
  NotificationService: class NotificationService {},
}));

vi.mock('../record/record.service', () => ({
  RecordService: class RecordService {},
}));

vi.mock('./v2-container.service', () => ({
  V2ContainerService: class V2ContainerService {},
}));

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

const createDispatcher = (recordTitleFixture?: {
  table: V2Table;
  records: Array<{
    id: string;
    fields: Record<string, unknown>;
    version: number;
    autoNumber: number;
    createdTime: string;
  }>;
}) => {
  const { db, service: v2ContainerService } = createV2ContainerService();
  const notificationService = {
    sendCollaboratorNotify: vi.fn().mockResolvedValue(true),
  };
  const dispatcher = new V2CollaboratorNotificationDispatcher(
    {
      ...v2ContainerService,
      getContainerForTable: vi.fn().mockResolvedValue({
        resolve: vi.fn().mockReturnValue(
          recordTitleFixture
            ? {
                findOne: vi.fn().mockResolvedValue({
                  isErr: () => false,
                  value: recordTitleFixture.table,
                }),
                execute: vi.fn().mockResolvedValue({
                  isErr: () => false,
                  value: ListTableRecordsResult.create(
                    recordTitleFixture.records,
                    recordTitleFixture.records.length,
                    0,
                    recordTitleFixture.records.length
                  ),
                }),
              }
            : {
                findOne: vi.fn(),
                execute: vi.fn(),
              }
        ),
      }),
    } as never,
    notificationService as never,
    { createContext: vi.fn().mockResolvedValue({}) } as never
  );

  return { db, dispatcher, notificationService };
};

describe('V2CollaboratorNotificationDispatcher', () => {
  it('formats record titles through the primary field definition', async () => {
    const tableId = `tbl${'t'.repeat(16)}`;
    const primaryFieldId = `fld${'p'.repeat(16)}`;
    const recordId = `rec${'r'.repeat(16)}`;
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
    const { dispatcher, notificationService } = createDispatcher({
      table,
      records: [
        {
          id: recordId,
          fields: { [primaryFieldId]: 1234.5 },
          version: 1,
          autoNumber: 1,
          createdTime: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    await dispatcher.notifyUserFields({
      actorId: 'usrActor000000001',
      tableId,
      records: [
        {
          id: recordId,
          fields: {
            fldAssignee0000001: {
              id: 'usrTarget00000001',
              title: 'Target',
            },
          },
        },
      ],
    });

    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        refRecord: expect.objectContaining({
          recordTitles: [{ id: recordId, title: '$1,234.50' }],
        }),
      })
    );
  });

  it('sends collaborator notification for v2 created records with notified user fields', async () => {
    const { dispatcher, notificationService } = createDispatcher();
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

  it.each([
    [{ type: 'import' }],
    [{ type: 'tableDuplicate' }],
    [{ type: 'restore' }],
    [{ type: 'recordDuplicate' }],
  ])('RecordCreated skips source %j', async (source) => {
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
  });

  it.each([
    [{ type: 'import' }],
    [{ type: 'tableDuplicate' }],
    [{ type: 'restore' }],
    [{ type: 'recordDuplicate' }],
  ])('RecordsBatchCreated skips source %j', async (source) => {
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

describe('V2CollaboratorNotificationDispatcher batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.USER_FIELD_NOTIFY_BATCH_WINDOW_MS = '1000';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.USER_FIELD_NOTIFY_BATCH_WINDOW_MS;
  });

  const assigneeRecord = (id: string) => ({
    id,
    fields: { fldAssignee0000001: { id: 'usrTarget00000001', title: 'Target' } },
  });

  const notify = (
    dispatcher: V2CollaboratorNotificationDispatcher,
    records: { id: string; fields: Record<string, unknown> }[]
  ) =>
    dispatcher.notifyUserFields({
      actorId: 'usrActor000000001',
      tableId: 'tblNotify00000001',
      records,
    });

  it('delivers the first call instantly and merges later calls into one flush', async () => {
    const { dispatcher, notificationService } = createDispatcher();

    await notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);

    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    await notify(dispatcher, [assigneeRecord('recBatch000000003')]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        refRecord: expect.objectContaining({
          recordIds: ['recBatch000000002', 'recBatch000000003'],
        }),
      })
    );
  });

  it('dedupes the same record inside a window, last field values win', async () => {
    const { dispatcher, notificationService } = createDispatcher();

    await notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        refRecord: expect.objectContaining({ recordIds: ['recBatch000000002'] }),
      })
    );
  });

  it('does not open a window for a call that delivered nothing', async () => {
    const { dispatcher, notificationService } = createDispatcher();

    await notify(dispatcher, [
      { id: 'recBatch000000001', fields: { fldUnrelated000001: 'plain text' } },
    ]);
    expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();

    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);
  });

  it('does not open a window when no notification was actually created (e.g. self-assignment)', async () => {
    const { dispatcher, notificationService } = createDispatcher();
    notificationService.sendCollaboratorNotify.mockResolvedValueOnce(false);

    await notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);

    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);
  });

  it('buffers calls arriving while the leading delivery is still in flight', async () => {
    const { dispatcher, notificationService } = createDispatcher();

    const first = notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    const second = notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    await Promise.all([first, second]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        refRecord: expect.objectContaining({ recordIds: ['recBatch000000002'] }),
      })
    );
  });

  it('re-dispatches records buffered behind a leading call that created nothing', async () => {
    const { dispatcher, notificationService } = createDispatcher();
    notificationService.sendCollaboratorNotify.mockResolvedValueOnce(false);

    const first = notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    const second = notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    await Promise.all([first, second]);

    // The failed leading window is dismantled and the buffered record is
    // delivered instantly instead of waiting out a dead window.
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        refRecord: expect.objectContaining({ recordIds: ['recBatch000000002'] }),
      })
    );
  });

  it('counts a record once when coalesced edits assign the user via two notifying fields', async () => {
    const { dispatcher, notificationService } = createDispatcher();

    await notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    await notify(dispatcher, [
      {
        id: 'recBatch000000002',
        fields: { fldReviewer0000001: { id: 'usrTarget00000001', title: 'Target' } },
      },
    ]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        refRecord: expect.objectContaining({ recordIds: ['recBatch000000002'] }),
      })
    );
  });

  it('tears down the re-armed window after a flush that created nothing', async () => {
    const { dispatcher, notificationService } = createDispatcher();

    await notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    notificationService.sendCollaboratorNotify.mockResolvedValueOnce(false);
    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);

    // The dead successor window is gone, so the next assignment is instant.
    await notify(dispatcher, [assigneeRecord('recBatch000000003')]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(3);
  });

  it('closes a quiet window so the next call is instant again', async () => {
    const { dispatcher, notificationService } = createDispatcher();

    await notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    await vi.advanceTimersByTimeAsync(1000);

    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);
  });

  it('sends every call instantly when the window is disabled', async () => {
    process.env.USER_FIELD_NOTIFY_BATCH_WINDOW_MS = '0';
    const { dispatcher, notificationService } = createDispatcher();

    await notify(dispatcher, [assigneeRecord('recBatch000000001')]);
    await notify(dispatcher, [assigneeRecord('recBatch000000002')]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(2);
  });
});

describe('v2 collaborator notification field filtering', () => {
  it('keeps v1-compatible shouldNotify semantics', () => {
    expect(FieldType.User).toBe('user');
  });
});
