import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Role } from '@teable/core';
import {
  deleteSpaceCollaborator,
  emailSpaceInvitation,
  getRecordHistory,
  PrincipalType,
  UPDATE_RECORD,
  urlBuilder,
  USER_ME,
} from '@teable/openapi';
import type { IUserMeVo } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import type { IBaseConfig } from '../src/configs/base.config';
import { baseConfig } from '../src/configs/base.config';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  createField,
  createRecords,
  createTable,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

/**
 * Regression for T4966: v2 record-history projections must attribute history to the
 * user who actually made the change, not to whoever happened to trigger the async
 * drain. v2 record events are drained outside the originating request (setImmediate
 * on a base-shared queue), so a concurrent request's drain ran in an unrelated user's
 * CLS context and stamped `record_history.created_by` with the wrong user. The fix
 * reads `context.actorId` (snapshotted per event at publish time) instead of CLS at
 * drain time.
 */
describe('Record history actor attribution under concurrency (e2e)', () => {
  let app: INestApplication;
  let secondUserAxios: AxiosInstance;
  let secondUser: IUserMeVo;

  const baseId = globalThis.testConfig.baseId;
  const spaceId = globalThis.testConfig.spaceId;
  const firstUserId = globalThis.testConfig.userId;
  const parallelWriters = 8;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const baseConfigService = app.get(baseConfig.KEY) as IBaseConfig;
    baseConfigService.recordHistoryDisabled = false;

    const secondUserEmail = `cls-attribution-${Date.now()}@example.com`;
    secondUserAxios = await createNewUserAxios({ email: secondUserEmail, password: '12345678' });
    secondUser = (await secondUserAxios.get<IUserMeVo>(USER_ME)).data;
    await emailSpaceInvitation({
      spaceId,
      emailSpaceInvitationRo: { role: Role.Editor, emails: [secondUserEmail] },
    });
  });

  afterAll(async () => {
    await deleteSpaceCollaborator({
      spaceId,
      deleteSpaceCollaboratorRo: {
        principalId: secondUser.id,
        principalType: PrincipalType.User,
      },
    }).catch(() => undefined);
    await app.close();
  });

  const waitForHistoryCreatedBy = async (
    tableId: string,
    recordId: string
  ): Promise<string | null> => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const { data } = await getRecordHistory(tableId, recordId, {});
      if (data.historyList.length > 0) {
        return data.historyList[0].createdBy;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  };

  it('attributes each record history to its acting user, not the drain-triggering user', async () => {
    const table = await createTable(baseId, { name: 'cls attribution crossing' });
    try {
      const noteField = await createField(table.id, { type: FieldType.SingleLineText });

      const { records } = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: Array.from({ length: parallelWriters * 2 }, () => ({ fields: {} })),
      });

      // Alternate ownership so the two users' RecordUpdated events interleave inside
      // the same shared async drain batch.
      const firstUserRecordIds = records.filter((_, i) => i % 2 === 0).map((r) => r.id);
      const secondUserRecordIds = records.filter((_, i) => i % 2 === 1).map((r) => r.id);

      // Fire all updates concurrently: first user via the global owner session,
      // second user via their own session. Distinct values guarantee a real change.
      await Promise.all([
        ...firstUserRecordIds.map((recordId, i) =>
          updateRecord(table.id, recordId, {
            record: { fields: { [noteField.id]: `first-${i}` } },
            fieldKeyType: FieldKeyType.Id,
          })
        ),
        ...secondUserRecordIds.map((recordId, i) =>
          secondUserAxios.patch(urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId }), {
            record: { fields: { [noteField.id]: `second-${i}` } },
            fieldKeyType: FieldKeyType.Id,
          })
        ),
      ]);

      const firstUserAttribution = await Promise.all(
        firstUserRecordIds.map((id) => waitForHistoryCreatedBy(table.id, id))
      );
      const secondUserAttribution = await Promise.all(
        secondUserRecordIds.map((id) => waitForHistoryCreatedBy(table.id, id))
      );

      expect(firstUserAttribution).toEqual(firstUserRecordIds.map(() => firstUserId));
      expect(secondUserAttribution).toEqual(secondUserRecordIds.map(() => secondUser.id));
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
