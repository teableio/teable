/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, HttpError, Role, getRandomString } from '@teable/core';
import type { ITableFullVo, IUserMeVo } from '@teable/openapi';
import {
  axios,
  CREATE_RECORD,
  emailBaseInvitation,
  UPDATE_USER_NAME,
  urlBuilder,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  createBase,
  createRecords,
  createSpace,
  createTable,
  getRecord,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
} from './utils/init-app';

/**
 * T7809 / Y2759 and T7810 / Y2761 — user-field value contract.
 *
 * T7809: with typecast a multi-user field accepts a comma-separated list; every
 * identifier that resolves to a collaborator must be kept and only the
 * unresolvable ones dropped. The mixed `email, 不存在的人` input used to discard
 * the whole cell (v2 split no tokens).
 *
 * T7810: a strict (non-typecast) single-user write with an id-only object must
 * resolve inside the table's collaborator scope, so a registered but
 * non-collaborator member is rejected 4xx with the user-not-found error and no
 * record is created. The id-only shape used to fail schema validation with a
 * misleading "title required" message before the scope check could run.
 *
 * Runs with FORCE_V2_ALL=true (the e2e runner default) so both requests route
 * through the v2 command handlers.
 */
describe('V2 user field value contract (e2e)', () => {
  let app: INestApplication;
  let spaceId: string;
  let baseId: string;

  let collaborator: IUserMeVo;
  let collaboratorEmail: string;
  let outsider: IUserMeVo;
  const collaboratorName = `李四${getRandomString(4)}`;

  // The first signup after app boot can starve the 8s interactive-transaction
  // timeout on a cold worker, so retry with a fresh email before giving up.
  const signUpUser = async (): Promise<{
    axios: AxiosInstance;
    user: IUserMeVo;
    email: string;
  }> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const email = `user-contract-${Date.now()}-${getRandomString(6).toLowerCase()}@example.com`;
        const instance = await createNewUserAxios({ email, password: '12345678' });
        const user = (await instance.get<IUserMeVo>(USER_ME)).data;
        // Use the canonical stored email (signup normalizes case).
        return { axios: instance, user, email: user.email };
      } catch (error) {
        // Only the cold-worker interactive-transaction timeout surfaces as an
        // HTTP 500; anything else is a real failure.
        if (!(error instanceof HttpError && error.status === 500)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const space = await createSpace({ name: `user-value-contract ${getRandomString(6)}` });
    spaceId = space.id;
    const base = await createBase({
      name: `user-value-contract ${getRandomString(6)}`,
      spaceId,
    });
    baseId = base.id;

    const createdCollaborator = await signUpUser();
    collaborator = createdCollaborator.user;
    collaboratorEmail = createdCollaborator.email;
    // Give the collaborator a name whose partial form is unambiguous.
    await createdCollaborator.axios.patch(UPDATE_USER_NAME, { name: collaboratorName });
    await emailBaseInvitation({
      baseId,
      emailBaseInvitationRo: { emails: [collaboratorEmail], role: Role.Editor },
    });

    // Registered on the platform but deliberately never invited to the base.
    outsider = (await signUpUser()).user;
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId);
    await permanentDeleteSpace(spaceId);
    await app.close();
  });

  describe('T7809 — typecast multi-user identifiers', () => {
    let table: ITableFullVo;
    let userFieldId: string;

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: `T7809 ${getRandomString(6)}`,
        records: [],
        fields: [
          { name: 'title', type: FieldType.SingleLineText, isPrimary: true },
          {
            name: '负责人',
            type: FieldType.User,
            options: { isMultiple: true, shouldNotify: false },
          },
        ],
      });
      userFieldId = table.fields.find((field) => field.name === '负责人')?.id ?? '';
    });

    afterAll(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    const writeAndRead = async (value: unknown) => {
      const { records } = await createRecords(table.id, {
        records: [{ fields: { [userFieldId]: value } }],
        typecast: true,
      });
      const record = await getRecord(table.id, records[0]!.id);
      return record.fields[userFieldId];
    };

    const expectSingleCollaborator = (value: unknown) => {
      expect(Array.isArray(value) ? value.length : 0).toBe(1);
      expect((value as unknown[])[0]).toMatchObject({
        id: collaborator.id,
        title: collaboratorName,
        email: collaboratorEmail,
      });
    };

    it('writes the collaborator when only the id is given', async () => {
      expectSingleCollaborator(await writeAndRead(collaborator.id));
    });

    it('writes the collaborator when the full name is given', async () => {
      expectSingleCollaborator(await writeAndRead(collaboratorName));
    });

    it('writes the collaborator when the email is given', async () => {
      expectSingleCollaborator(await writeAndRead(collaboratorEmail));
    });

    it('clears the cell when only a partial name matches', async () => {
      const value = await writeAndRead(collaboratorName.slice(0, -1));
      expect(value == null || (Array.isArray(value) && value.length === 0)).toBe(true);
    });

    it('keeps the resolvable collaborator and drops the unmatched item', async () => {
      expectSingleCollaborator(await writeAndRead(`${collaboratorEmail}, 不存在的人`));
    });
  });

  describe('T7810 — strict single-user id-only input is collaborator scoped', () => {
    let table: ITableFullVo;
    let userFieldId: string;

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: `T7810 ${getRandomString(6)}`,
        records: [],
        fields: [
          { name: 'title', type: FieldType.SingleLineText, isPrimary: true },
          {
            name: '负责人',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          },
        ],
      });
      userFieldId = table.fields.find((field) => field.name === '负责人')?.id ?? '';
    });

    afterAll(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('rejects a registered non-collaborator with the user-not-found error', async () => {
      const response = await axios.post(
        urlBuilder(CREATE_RECORD, { tableId: table.id }),
        { records: [{ fields: { 负责人: { id: outsider.id } } }] },
        { headers: { 'x-teable-v2': 'true' }, validateStatus: () => true }
      );

      expect(response.status).toBe(400);
      expect(response.data.data.domainCode).toBe('validation.field.user_not_found');
      expect(response.data.data.localization).toMatchObject({
        i18nKey: 'httpErrors.user.notFound',
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records).toHaveLength(0);
    });

    it('accepts an id-only object for a collaborator', async () => {
      const collaboratorId = globalThis.testConfig.userId;
      const response = await axios.post(
        urlBuilder(CREATE_RECORD, { tableId: table.id }),
        { records: [{ fields: { 负责人: { id: collaboratorId } } }] },
        { headers: { 'x-teable-v2': 'true' }, validateStatus: () => true }
      );

      expect(response.status).toBe(201);
      expect(response.headers['x-teable-v2']).toBe('true');

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records).toHaveLength(1);
      expect(records[0]!.fields[userFieldId]).toMatchObject({ id: collaboratorId });
    });
  });
});
