import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILinkFieldOptionsRo, ILookupOptionsRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  deleteSpaceCollaborator,
  emailSpaceInvitation,
  getRecord,
  getRecords,
  updateRecord,
  USER_ME,
  deleteTable,
  UPDATE_USER_NAME,
  urlBuilder,
  CREATE_FIELD,
  CREATE_TABLE,
  emailBaseInvitation,
  PrincipalType,
} from '@teable/openapi';
import type { IUserMeVo, ITableFullVo } from '@teable/openapi';
import { ActorId, type IComputedUpdateDrainService, v2CoreTokens } from '@teable/v2-core';
import type { AxiosInstance } from 'axios';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  deleteBase,
  deleteField,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Computed user field (e2e)', () => {
  let app: INestApplication;
  let v2ContainerService: V2ContainerService;
  let prisma: PrismaService;
  const spaceId = globalThis.testConfig.spaceId;
  const userName = globalThis.testConfig.userName;
  const isForceV2 = process.env.FORCE_V2_ALL === 'true';
  let isV2Mode = isForceV2;
  let baseId: string;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    v2ContainerService = app.get(V2ContainerService);
    prisma = app.get(PrismaService);
    const base = await createBase({ name: 'base1', spaceId });
    baseId = base.id;
    const baseMeta = await prisma.base.findUnique({
      where: { id: baseId },
      select: { v2Enabled: true },
    });
    isV2Mode = isForceV2 || Boolean(baseMeta?.v2Enabled);
  });

  afterAll(async () => {
    await deleteBase(baseId);
    await app.close();
  });

  async function processV2Outbox(): Promise<void> {
    if (!isV2Mode) return;

    const container = await v2ContainerService.getContainer();
    const drainService = container.resolve<IComputedUpdateDrainService>(
      v2CoreTokens.computedUpdateDrainService
    );
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    let iterations = 0;

    while (iterations < 100) {
      const result = await drainService.drainOnce(context, {
        workerId: 'computed-user-field-test',
        limit: 100,
      });

      if (result.isErr()) {
        throw new Error(`Outbox processing failed: ${result.error.message}`);
      }

      if (result.value === 0) {
        return;
      }

      iterations++;
    }

    throw new Error('Timed out draining computed update outbox');
  }

  describe('CRUD', () => {
    let table1: ITableFullVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await deleteTable(baseId, table1.id);
    });

    it('should create a created by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.CreatedBy,
      };

      const createdByField = await createField(table1.id, fieldRo);
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      records.data.records.forEach((record) => {
        expect(record.fields[createdByField.id]).toMatchObject({
          title: userName,
        });
      });
    });

    it('should create a last modified by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedBy,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedByField = await createField(table1.id, fieldRo);
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      if (isV2Mode) {
        expect(records.data.records[1].fields[lastModifiedByField.id]).toMatchObject({
          title: userName,
        });
      } else {
        expect(records.data.records[1].fields[lastModifiedByField.id]).toBeUndefined();
      }

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, records.data.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });
    });

    it('should update formula result depends on a last modified by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedBy,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedByField = await createField(table1.id, fieldRo);

      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${lastModifiedByField.id}}`,
        },
      };

      const formulaField = await createField(table1.id, formulaFieldRo);

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      expect(records.data.records[0].fields[formulaField.id]).toEqual(userName);

      if (isV2Mode) {
        expect(records.data.records[1].fields[lastModifiedByField.id]).toMatchObject({
          title: userName,
        });
        expect(records.data.records[1].fields[formulaField.id]).toEqual(userName);
      } else {
        expect(records.data.records[1].fields[lastModifiedByField.id]).toBeUndefined();
      }

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, table1.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      expect(updatedRecord.data.fields[formulaField.id]).toEqual(userName);
    });

    it('should update formula result depends on a last modified time field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedTime,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedTimeField = await createField(table1.id, fieldRo);

      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${lastModifiedTimeField.id}}`,
        },
      };

      const formulaField = await createField(table1.id, formulaFieldRo);

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedTimeField.id]).toEqual(
        records.data.records[0].lastModifiedTime
      );

      expect(records.data.records[0].fields[formulaField.id]).toEqual(
        records.data.records[0].lastModifiedTime
      );

      if (isV2Mode) {
        expect(records.data.records[1].fields[lastModifiedTimeField.id]).toEqual(
          records.data.records[1].lastModifiedTime
        );
        expect(records.data.records[1].fields[formulaField.id]).toEqual(
          records.data.records[1].lastModifiedTime
        );
      } else {
        expect(records.data.records[1].fields[lastModifiedTimeField.id]).toBeUndefined();
      }

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, table1.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedTimeField.id]).toEqual(
        updatedRecord.data.lastModifiedTime
      );

      expect(updatedRecord.data.fields[formulaField.id]).toEqual(
        updatedRecord.data.lastModifiedTime
      );
    });

    it('should allow configuring Last Modified By field to track specific fields only', async () => {
      const textField = await createField(table1.id, {
        name: 'text-field',
        type: FieldType.SingleLineText,
      });
      const numberField = await createField(table1.id, {
        name: 'number-field',
        type: FieldType.Number,
      });

      const lastModifiedByField = await createField(table1.id, {
        type: FieldType.LastModifiedBy,
        options: {
          trackedFieldIds: [textField.id],
        },
      });

      const recordId = table1.records[0].id;

      await updateRecord(table1.id, recordId, {
        record: {
          fields: {
            [numberField.id]: 1,
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      let record = await getRecord(table1.id, recordId, { fieldKeyType: FieldKeyType.Id });
      if (isV2Mode) {
        expect(record.data.fields[lastModifiedByField.id]).toMatchObject({
          id: globalThis.testConfig.userId,
          title: globalThis.testConfig.userName,
        });
      } else {
        expect(record.data.fields[lastModifiedByField.id]).toBeUndefined();
      }

      await updateRecord(table1.id, recordId, {
        record: {
          fields: {
            [textField.id]: 'tracked change',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      record = await getRecord(table1.id, recordId, { fieldKeyType: FieldKeyType.Id });
      expect(record.data.fields[lastModifiedByField.id]).toMatchObject({
        id: globalThis.testConfig.userId,
        title: globalThis.testConfig.userName,
      });
    });

    it('should fall back to track all when tracked fields are removed', async () => {
      const textField = await createField(table1.id, {
        name: 'text-field',
        type: FieldType.SingleLineText,
      });
      const numberField = await createField(table1.id, {
        name: 'number-field',
        type: FieldType.Number,
      });

      const lastModifiedByField = await createField(table1.id, {
        type: FieldType.LastModifiedBy,
        options: {
          trackedFieldIds: [textField.id],
        },
      });

      const recordId = table1.records[0].id;

      await updateRecord(table1.id, recordId, {
        record: {
          fields: {
            [numberField.id]: 1,
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      let record = await getRecord(table1.id, recordId, { fieldKeyType: FieldKeyType.Id });
      if (isV2Mode) {
        expect(record.data.fields[lastModifiedByField.id]).toMatchObject({
          id: globalThis.testConfig.userId,
          title: globalThis.testConfig.userName,
        });
      } else {
        expect(record.data.fields[lastModifiedByField.id]).toBeUndefined();
      }

      await deleteField(table1.id, textField.id);

      await updateRecord(table1.id, recordId, {
        record: {
          fields: {
            [numberField.id]: 2,
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      record = await getRecord(table1.id, recordId, { fieldKeyType: FieldKeyType.Id });
      expect(record.data.fields[lastModifiedByField.id]).toMatchObject({
        id: globalThis.testConfig.userId,
        title: globalThis.testConfig.userName,
      });
    });

    it('should persist multi-user formula values via computed updates', async () => {
      const userField = await createField(table1.id, {
        type: FieldType.User,
        options: {
          isMultiple: true,
          shouldNotify: false,
        },
      });

      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${userField.id}}`,
        },
      });

      expect(formulaField.isMultipleCellValue).toBe(true);

      const recordId = table1.records[0].id;

      await updateRecord(table1.id, recordId, {
        record: {
          fields: {
            [userField.id]: [globalThis.testConfig.userId],
          },
        },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      });

      const updatedRecord = await getRecord(table1.id, recordId, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[userField.id]).toEqual([
        expect.objectContaining({ title: globalThis.testConfig.userName }),
      ]);
      expect(updatedRecord.data.fields[formulaField.id]).toContain(globalThis.testConfig.userName);
    });
  });

  describe('rename', () => {
    const renameUserEmail = `rename-user-${Date.now()}@example.com`;
    let user2Request: AxiosInstance;
    let user2: IUserMeVo;
    let table1: ITableFullVo;
    let eventEmitterService: EventEmitterService;
    let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<T>;

    beforeAll(async () => {
      user2Request = await createNewUserAxios({
        email: renameUserEmail,
        password: '12345678',
      });
      eventEmitterService = app.get(EventEmitterService);
      awaitWithEvent = createAwaitWithEvent(eventEmitterService, Events.TABLE_USER_RENAME_COMPLETE);

      await awaitWithEvent(() =>
        user2Request.patch<void>(urlBuilder(UPDATE_USER_NAME), { name: 'default' })
      );
      user2 = (await user2Request.get<IUserMeVo>(USER_ME)).data;

      await emailSpaceInvitation({
        spaceId: globalThis.testConfig.spaceId,
        emailSpaceInvitationRo: { role: Role.Creator, emails: [renameUserEmail] },
      });
      table1 = (
        await user2Request.post<ITableFullVo>(urlBuilder(CREATE_TABLE, { baseId }), {
          name: 'table1',
        })
      ).data;
    });

    afterAll(async () => {
      await deleteSpaceCollaborator({
        spaceId: globalThis.testConfig.spaceId,
        deleteSpaceCollaboratorRo: {
          principalId: user2.id,
          principalType: PrincipalType.User,
        },
      });
      await deleteTable(baseId, table1.id);
    });

    it('should update createdBy fields when user rename', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.CreatedBy,
      };

      const field = await user2Request
        .post<IFieldVo>(urlBuilder(CREATE_FIELD, { tableId: table1.id }), fieldRo)
        .then((res) => res.data);

      console.log('user2user2', user2);
      await awaitWithEvent(() => user2Request.patch<void>(UPDATE_USER_NAME, { name: 'new name' }));

      console.log('user2user2 res', (await user2Request.get<IUserMeVo>(USER_ME)).data);
      const getRecordsResponse = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      getRecordsResponse.data.records.forEach((record) => {
        expect(record.fields[field.id]).toMatchObject({
          title: 'new name',
        });
      });
    });

    it('should update createBy fields when user rename - base collaborator', async () => {
      const user3Email = `rename-user3-${Date.now()}@example.com`;
      const user3Request = await createNewUserAxios({
        email: user3Email,
        password: '12345678',
      });
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { role: Role.Creator, emails: [user3Email] },
      });
      const table = (
        await user3Request.post<ITableFullVo>(urlBuilder(CREATE_TABLE, { baseId }), {
          name: 'table2',
        })
      ).data;
      const field = await user3Request
        .post<IFieldVo>(urlBuilder(CREATE_FIELD, { tableId: table.id }), {
          type: FieldType.CreatedBy,
        })
        .then((res) => res.data);
      await awaitWithEvent(() => user3Request.patch<void>(UPDATE_USER_NAME, { name: 'new name' }));

      const getRecordsResponse = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      getRecordsResponse.data.records.forEach((record) => {
        expect(record.fields[field.id]).toMatchObject({
          title: 'new name',
        });
      });
    });

    it('should update user fields when user rename', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.User,
        options: {
          isMultiple: true,
          shouldNotify: false,
        },
      };

      const field = (
        await user2Request.post<IFieldVo>(urlBuilder(CREATE_FIELD, { tableId: table1.id }), fieldRo)
      ).data;

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [field.id]: [globalThis.testConfig.userId, user2.id],
          },
        },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      });

      await awaitWithEvent(() =>
        user2Request.patch<void>(UPDATE_USER_NAME, { name: 'new name 2' })
      );

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records.data.records[0].fields[field.id]).toMatchObject([
        {
          title: 'test',
        },
        {
          title: 'new name 2',
        },
      ]);
    });

    it('should cascade user rename through lookup and downstream computed fields', async () => {
      const initialName = 'rename-chain-initial';
      const nextName = 'rename-chain-next';
      let sourceTableId: string | undefined;
      let hostTableId: string | undefined;
      let summaryTableId: string | undefined;

      try {
        await awaitWithEvent(() =>
          user2Request.patch<void>(UPDATE_USER_NAME, { name: initialName })
        );

        const sourceTable = await createTable(baseId, {
          name: 'rename-user-source',
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        });
        sourceTableId = sourceTable.id;

        const sourcePrimaryFieldId = sourceTable.fields.find((field) => field.isPrimary)?.id;
        if (!sourcePrimaryFieldId) {
          throw new Error('Missing source primary field');
        }

        const ownerField = await createField(sourceTable.id, {
          name: 'Owner',
          type: FieldType.User,
          options: {
            isMultiple: false,
            shouldNotify: false,
          },
        });

        const ownerFormulaField = await createField(sourceTable.id, {
          name: 'Owner Formula',
          type: FieldType.Formula,
          options: {
            expression: `{${ownerField.id}}`,
          },
        });

        const sourceRecords = await createRecords(sourceTable.id, {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records: [
            {
              fields: {
                [sourcePrimaryFieldId]: 'source-1',
                [ownerField.id]: {
                  id: user2.id,
                  title: initialName,
                },
              },
            },
          ],
        });
        const sourceRecordId = sourceRecords.records[0].id;

        const hostTable = await createTable(baseId, {
          name: 'rename-user-host',
          fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        });
        hostTableId = hostTable.id;

        const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
        if (!hostPrimaryFieldId) {
          throw new Error('Missing host primary field');
        }

        const sourceLinkField = await createField(hostTable.id, {
          name: 'Source',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: sourceTable.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const lookupOwnerField = await createField(hostTable.id, {
          name: 'Lookup Owner',
          type: FieldType.User,
          isLookup: true,
          lookupOptions: {
            foreignTableId: sourceTable.id,
            linkFieldId: sourceLinkField.id,
            lookupFieldId: ownerField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const lookupOwnerFormulaField = await createField(hostTable.id, {
          name: 'Lookup Owner Formula',
          type: FieldType.Formula,
          options: {
            expression: `{${lookupOwnerField.id}}`,
          },
        });

        const hostRecords = await createRecords(hostTable.id, {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records: [
            {
              fields: {
                [hostPrimaryFieldId]: 'host-1',
                [sourceLinkField.id]: { id: sourceRecordId },
              },
            },
          ],
        });
        const hostRecordId = hostRecords.records[0].id;

        const summaryTable = await createTable(baseId, {
          name: 'rename-user-summary',
          fields: [{ name: 'Summary', type: FieldType.SingleLineText }],
        });
        summaryTableId = summaryTable.id;

        const summaryPrimaryFieldId = summaryTable.fields.find((field) => field.isPrimary)?.id;
        if (!summaryPrimaryFieldId) {
          throw new Error('Missing summary primary field');
        }

        const hostLinkField = await createField(summaryTable.id, {
          name: 'Hosts',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: hostTable.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const hostOwnerRollupField = await createField(summaryTable.id, {
          name: 'Host Owner Names',
          type: FieldType.Rollup,
          options: {
            expression: 'array_join({values})',
          },
          lookupOptions: {
            foreignTableId: hostTable.id,
            linkFieldId: hostLinkField.id,
            lookupFieldId: lookupOwnerFormulaField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const summaryRecords = await createRecords(summaryTable.id, {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records: [
            {
              fields: {
                [summaryPrimaryFieldId]: 'summary-1',
                [hostLinkField.id]: [{ id: hostRecordId }],
              },
            },
          ],
        });
        const summaryRecordId = summaryRecords.records[0].id;

        const waitForSourceOwnerSnapshot = async (expectedName: string) => {
          const timeoutMs = process.env.CI ? 15000 : 5000;
          const startedAt = Date.now();
          let latestSourceRecord: Awaited<ReturnType<typeof getRecord>>['data'] | undefined;

          while (Date.now() - startedAt < timeoutMs) {
            await processV2Outbox();
            latestSourceRecord = (
              await getRecord(sourceTable.id, sourceRecordId, { fieldKeyType: FieldKeyType.Id })
            ).data;

            if (latestSourceRecord.fields[ownerField.id]?.title === expectedName) {
              return latestSourceRecord;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          latestSourceRecord =
            latestSourceRecord ??
            (await getRecord(sourceTable.id, sourceRecordId, { fieldKeyType: FieldKeyType.Id }))
              .data;

          expect(latestSourceRecord.fields[ownerField.id]).toMatchObject({ title: expectedName });
          return latestSourceRecord;
        };

        const waitForRenameChain = async (expectedName: string) => {
          const timeoutMs = process.env.CI ? 15000 : 5000;
          const startedAt = Date.now();
          let latestSourceRecord: Awaited<ReturnType<typeof getRecord>>['data'] | undefined;
          let latestHostRecord: Awaited<ReturnType<typeof getRecord>>['data'] | undefined;
          let latestSummaryRecord: Awaited<ReturnType<typeof getRecord>>['data'] | undefined;

          // Lookup -> formula -> rollup propagation can still be settling when the
          // record read happens immediately after setup or rename in CI shards.
          // When FORCE_V2_ALL is enabled, drain the computed outbox explicitly so the
          // test waits on real propagation work instead of only wall-clock time.
          while (Date.now() - startedAt < timeoutMs) {
            await processV2Outbox();
            latestSourceRecord = (
              await getRecord(sourceTable.id, sourceRecordId, { fieldKeyType: FieldKeyType.Id })
            ).data;
            latestHostRecord = (
              await getRecord(hostTable.id, hostRecordId, { fieldKeyType: FieldKeyType.Id })
            ).data;
            latestSummaryRecord = (
              await getRecord(summaryTable.id, summaryRecordId, { fieldKeyType: FieldKeyType.Id })
            ).data;

            if (
              latestSourceRecord.fields[ownerField.id]?.title === expectedName &&
              latestSourceRecord.fields[ownerFormulaField.id] === expectedName &&
              latestHostRecord.fields[lookupOwnerField.id]?.title === expectedName &&
              String(latestHostRecord.fields[lookupOwnerFormulaField.id] ?? '').includes(
                expectedName
              ) &&
              String(latestSummaryRecord.fields[hostOwnerRollupField.id] ?? '').includes(
                expectedName
              )
            ) {
              return {
                sourceRecord: latestSourceRecord,
                hostRecord: latestHostRecord,
                summaryRecord: latestSummaryRecord,
              };
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          latestSourceRecord =
            latestSourceRecord ??
            (await getRecord(sourceTable.id, sourceRecordId, { fieldKeyType: FieldKeyType.Id }))
              .data;
          latestHostRecord =
            latestHostRecord ??
            (await getRecord(hostTable.id, hostRecordId, { fieldKeyType: FieldKeyType.Id })).data;
          latestSummaryRecord =
            latestSummaryRecord ??
            (await getRecord(summaryTable.id, summaryRecordId, { fieldKeyType: FieldKeyType.Id }))
              .data;

          expect(latestSourceRecord.fields[ownerField.id]).toMatchObject({ title: expectedName });
          expect(latestSourceRecord.fields[ownerFormulaField.id]).toEqual(expectedName);
          expect(latestHostRecord.fields[lookupOwnerField.id]).toMatchObject({
            title: expectedName,
          });
          expect(String(latestHostRecord.fields[lookupOwnerFormulaField.id] ?? '')).toContain(
            expectedName
          );
          expect(String(latestSummaryRecord.fields[hostOwnerRollupField.id] ?? '')).toContain(
            expectedName
          );

          return {
            sourceRecord: latestSourceRecord,
            hostRecord: latestHostRecord,
            summaryRecord: latestSummaryRecord,
          };
        };

        // The behavior under test is the rename cascade. Initial create-time formula/rollup
        // backfill is covered elsewhere and can settle later than the raw user snapshot in CI.
        const sourceBeforeRename = await waitForSourceOwnerSnapshot(initialName);
        expect(sourceBeforeRename.fields[ownerField.id]).toMatchObject({ title: initialName });

        await awaitWithEvent(() => user2Request.patch<void>(UPDATE_USER_NAME, { name: nextName }));
        await processV2Outbox();

        const {
          sourceRecord: sourceAfterRename,
          hostRecord: hostAfterRename,
          summaryRecord: summaryAfterRename,
        } = await waitForRenameChain(nextName);

        expect(sourceAfterRename.fields[ownerField.id]).toMatchObject({ title: nextName });
        expect(sourceAfterRename.fields[ownerFormulaField.id]).toEqual(nextName);
        expect(hostAfterRename.fields[lookupOwnerField.id]).toMatchObject({ title: nextName });
        expect(String(hostAfterRename.fields[lookupOwnerFormulaField.id])).toContain(nextName);
        expect(String(summaryAfterRename.fields[hostOwnerRollupField.id])).toContain(nextName);
      } finally {
        if (summaryTableId) {
          await permanentDeleteTable(baseId, summaryTableId);
        }
        if (hostTableId) {
          await permanentDeleteTable(baseId, hostTableId);
        }
        if (sourceTableId) {
          await permanentDeleteTable(baseId, sourceTableId);
        }
      }
    });
  });
});
