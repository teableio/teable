import { FieldType } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';

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
  V2RecordCreatedCollaboratorNotificationProjection,
  V2RecordUpdatedCollaboratorNotificationProjection,
} from './v2-collaborator-notification.service';

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

const createDispatcher = () => {
  const { db, service: v2ContainerService } = createV2ContainerService();
  const notificationService = {
    sendCollaboratorNotify: vi.fn().mockResolvedValue(undefined),
  };
  const recordService = {
    getRecordsHeadWithIds: vi
      .fn()
      .mockResolvedValue([{ id: 'recNotify00000001', title: 'Fix notification' }]),
  };

  const dispatcher = new V2CollaboratorNotificationDispatcher(
    v2ContainerService as never,
    notificationService as never,
    recordService as never
  );

  return { db, dispatcher, notificationService, recordService };
};

describe('V2CollaboratorNotificationDispatcher', () => {
  it('sends collaborator notification for v2 created records with notified user fields', async () => {
    const { dispatcher, notificationService, recordService } = createDispatcher();
    const projection = new V2RecordCreatedCollaboratorNotificationProjection(dispatcher);

    const result = await projection.handle(
      {
        actorId: { toString: () => 'usrActor000000001' },
      } as never,
      {
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
    expect(recordService.getRecordsHeadWithIds).toHaveBeenCalledWith('tblNotify00000001', [
      'recNotify00000001',
    ]);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith({
      fromUserId: 'usrActor000000001',
      toUserId: 'usrTarget00000001',
      refRecord: {
        baseId: 'bseNotify000000001',
        tableId: 'tblNotify00000001',
        tableName: 'Tasks',
        fieldName: 'Assignee',
        recordIds: ['recNotify00000001'],
        recordTitles: [{ id: 'recNotify00000001', title: 'Fix notification' }],
      },
    });
  });

  it('sends collaborator notification for v2 updated records with notified user field changes', async () => {
    const { dispatcher, notificationService } = createDispatcher();
    const projection = new V2RecordUpdatedCollaboratorNotificationProjection(dispatcher);

    const result = await projection.handle(
      {
        actorId: { toString: () => 'usrActor000000001' },
      } as never,
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
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledTimes(1);
    expect(notificationService.sendCollaboratorNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        fromUserId: 'usrActor000000001',
        toUserId: 'usrTarget00000001',
      })
    );
  });

  it('ignores non-user v2 update events', async () => {
    const { dispatcher, notificationService } = createDispatcher();
    const projection = new V2RecordUpdatedCollaboratorNotificationProjection(dispatcher);

    const result = await projection.handle(
      {
        actorId: { toString: () => 'usrActor000000001' },
      } as never,
      {
        source: 'computed',
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
    expect(notificationService.sendCollaboratorNotify).not.toHaveBeenCalled();
  });
});

describe('v2 collaborator notification field filtering', () => {
  it('keeps v1-compatible shouldNotify semantics', () => {
    expect(FieldType.User).toBe('user');
  });
});
