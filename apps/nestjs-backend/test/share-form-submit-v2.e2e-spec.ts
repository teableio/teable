import type { INestApplication } from '@nestjs/common';
import { ANONYMOUS_USER_ID, FieldType, ViewType, generateFieldId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICanaryConfig, ITableFullVo } from '@teable/openapi';
import {
  FORM_SUBMIT,
  SHARE_VIEW_AUTH,
  axios,
  disableShareView,
  getSetting,
  SHARE_VIEW_FORM_SUBMIT,
  SettingKey,
  enableShareView,
  updateSetting,
  updateViewColumnMeta,
  updateViewShareMeta,
  urlBuilder,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createSpace,
  createTable,
  createView,
  getRecord,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
} from './utils/init-app';

/**
 * T6145: public share form-submit must participate in V2 canary routing.
 * Before the fix, ShareController only used ShareAuthGuard and always called V1.
 *
 * Mirrors production canary case: base.v2_enabled=false on a canary space should still
 * route supported @UseV2Feature operations to V2 with reason=space_feature.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

describe('Share form-submit V2 canary routing (e2e) T6145', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let spaceId: string;
  let baseId: string;
  let table: ITableFullVo;
  let formViewId: string;
  let shareId: string;
  let nameFieldId: string;
  let anonymousUser: AxiosInstance;
  let previousForceV2All: string | undefined;
  let previousEnableCanaryFeature: string | undefined;
  let previousCanaryConfig: ICanaryConfig | null | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    previousEnableCanaryFeature = process.env.ENABLE_CANARY_FEATURE;
    process.env.FORCE_V2_ALL = 'false';
    process.env.ENABLE_CANARY_FEATURE = 'true';

    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    anonymousUser = createAnonymousUserAxios(appCtx.appUrl);
    previousCanaryConfig = (await getSetting()).data.canaryConfig;

    const space = await createSpace({ name: `share-form-v2-${Date.now()}` });
    spaceId = space.id;
    const base = await createBase({ spaceId, name: `share-form-v2-base-${Date.now()}` });
    baseId = base.id;

    table = await createTable(baseId, {
      name: 'share-form-v2-table',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      views: [{ name: 'Grid', type: ViewType.Grid }],
      records: [],
    });
    nameFieldId = table.fields.find((f) => f.name === 'Name')!.id;

    const formView = await createView(table.id, {
      type: ViewType.Form,
      name: 'share-form-v2-form',
    });
    formViewId = formView.id;
    shareId = (await enableShareView({ tableId: table.id, viewId: formViewId })).data.shareId;

    // Match issue scenario: legacy base (not V2 new base) under space canary.
    // Flip after table/view bootstrap so setup stays on the fast V2 create path.
    await prisma.base.update({ where: { id: baseId }, data: { v2Enabled: false } });
  });

  afterAll(async () => {
    await updateSetting({
      [SettingKey.CANARY_CONFIG]: previousCanaryConfig ?? { enabled: false, spaceIds: [] },
    }).catch(() => undefined);

    if (table?.id) {
      await permanentDeleteTable(baseId, table.id).catch(() => undefined);
    }
    if (baseId) {
      await permanentDeleteBase(baseId).catch(() => undefined);
    }
    if (spaceId) {
      await permanentDeleteSpace(spaceId).catch(() => undefined);
    }

    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    if (previousEnableCanaryFeature === undefined) {
      delete process.env.ENABLE_CANARY_FEATURE;
    } else {
      process.env.ENABLE_CANARY_FEATURE = previousEnableCanaryFeature;
    }

    await app?.close();
  });

  beforeEach(async () => {
    process.env.FORCE_V2_ALL = 'false';
    await updateSetting({ [SettingKey.CANARY_CONFIG]: { enabled: false, spaceIds: [] } });
  });

  afterEach(async () => {
    process.env.FORCE_V2_ALL = 'false';
    await updateSetting({
      [SettingKey.CANARY_CONFIG]: previousCanaryConfig ?? { enabled: false, spaceIds: [] },
    });
  });

  const submitShareForm = async () => {
    return anonymousUser.post(urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId }), {
      fields: {
        [nameFieldId]: `T6145-${Date.now()}`,
      },
      typecast: true,
    });
  };

  it('should route canary space public share form-submit to V2 (T6145)', async () => {
    await updateSetting({
      [SettingKey.CANARY_CONFIG]: {
        enabled: true,
        spaceIds: [spaceId],
      },
    });

    const res = await submitShareForm();

    expect(res.status).toBe(201);
    expect(res.data.id).toBeDefined();
    expect(res.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(res.headers[X_TEABLE_V2_REASON_HEADER]).toBe('space_feature');
    expect(res.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('formSubmit');
  });

  it('should keep non-canary public share form-submit on V1 (T6145)', async () => {
    await updateSetting({
      [SettingKey.CANARY_CONFIG]: {
        enabled: true,
        spaceIds: [],
      },
    });

    const res = await submitShareForm();

    expect(res.status).toBe(201);
    expect(res.data.id).toBeDefined();
    expect(res.headers[X_TEABLE_V2_HEADER]).toBe('false');
    expect(res.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('formSubmit');
  });

  it('should route FORCE_V2_ALL public share form-submit to V2 (T6145)', async () => {
    process.env.FORCE_V2_ALL = 'true';

    const res = await submitShareForm();

    expect(res.status).toBe(201);
    expect(res.data.id).toBeDefined();
    expect(res.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(res.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    expect(res.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('formSubmit');
  });

  it('should reject hidden fields on V2 share form-submit (T6145)', async () => {
    process.env.FORCE_V2_ALL = 'true';

    const extraField = await createField(table.id, {
      name: `Hidden-${Date.now()}`,
      type: FieldType.SingleLineText,
    });
    await updateViewColumnMeta(table.id, formViewId, [
      { fieldId: extraField.id, columnMeta: { visible: false } },
    ]);

    const error = await getError(() =>
      anonymousUser.post(urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId }), {
        fields: {
          [nameFieldId]: 'visible-ok',
          [extraField.id]: 'hidden-not-allowed',
        },
        typecast: true,
      })
    );

    expect(error?.status).toBe(403);
  });

  it('submits authorized hidden fields through v2 (T8457)', async () => {
    process.env.FORCE_V2_ALL = 'true';
    const visibleValue = `T8457-hidden-allowed-${Date.now()}`;

    const extraField = await createField(table.id, {
      name: `HiddenAllowed-${Date.now()}`,
      type: FieldType.SingleLineText,
    });
    await updateViewColumnMeta(table.id, formViewId, [
      { fieldId: extraField.id, columnMeta: { visible: false } },
    ]);
    await updateViewShareMeta(table.id, formViewId, {
      includeHiddenField: true,
    });

    try {
      const res = await anonymousUser.post(urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId }), {
        fields: {
          [nameFieldId]: visibleValue,
          [extraField.id]: 'hidden-value',
        },
        typecast: true,
      });

      expect(res.status).toBe(201);
      expect(res.data.fields[extraField.id]).toBe('hidden-value');
      expect(res.data.fields[nameFieldId]).toBe(visibleValue);
      const persisted = await getRecord(table.id, res.data.id);
      expect(persisted.fields).toMatchObject({
        [nameFieldId]: visibleValue,
        [extraField.id]: 'hidden-value',
      });
      expect(persisted.createdBy).toBe(ANONYMOUS_USER_ID);
      expect(res.data).toMatchObject({
        id: persisted.id,
        createdBy: persisted.createdBy,
        createdTime: persisted.createdTime,
        lastModifiedBy: persisted.lastModifiedBy,
        lastModifiedTime: persisted.lastModifiedTime,
        fields: persisted.fields,
      });
      expect(res.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(res.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(res.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('formSubmit');
    } finally {
      await updateViewShareMeta(table.id, formViewId, {
        includeHiddenField: false,
      });
    }
  });

  describe('hidden-field HTTP trust boundaries (T8457)', () => {
    let fixture: ITableFullVo;
    let viewId: string;
    let publicShareId: string;
    let visibleId: string;
    let hiddenId: string;
    const otherTables: string[] = [];

    beforeEach(async () => {
      process.env.FORCE_V2_ALL = 'true';
      fixture = await createTable(baseId, {
        name: 'T8457 isolated form',
        fields: [
          { name: 'Visible', type: FieldType.SingleLineText },
          { name: 'Hidden', type: FieldType.SingleLineText },
        ],
        records: [],
      });
      visibleId = fixture.fields.find(({ name }) => name === 'Visible')!.id;
      hiddenId = fixture.fields.find(({ name }) => name === 'Hidden')!.id;
      viewId = (await createView(fixture.id, { type: ViewType.Form, name: 'Public form' })).id;
      await updateViewColumnMeta(fixture.id, viewId, [
        { fieldId: hiddenId, columnMeta: { visible: false } },
      ]);
      publicShareId = (await enableShareView({ tableId: fixture.id, viewId })).data.shareId;
    });

    afterEach(async () => {
      process.env.FORCE_V2_ALL = 'true';
      for (const tableId of otherTables.splice(0)) {
        await permanentDeleteTable(baseId, tableId);
      }
      if (fixture?.id) await permanentDeleteTable(baseId, fixture.id);
    });

    const submit = (body: Record<string, unknown>, params?: Record<string, unknown>) =>
      anonymousUser.post(urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId: publicShareId }), body, {
        params,
      });

    const expectNoRecords = async () => {
      expect((await getRecords(fixture.id)).records).toHaveLength(0);
    };

    const expectEngine = (headers: Record<string, unknown>, v2: boolean) => {
      expect(headers[X_TEABLE_V2_HEADER]).toBe(String(v2));
      expect(headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('formSubmit');
      if (v2) expect(headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    };

    it.each([false, true])(
      'keeps hidden input forbidden and atomic when includeHiddenField is missing or false (v2=%s)',
      async (v2) => {
        process.env.FORCE_V2_ALL = String(v2);
        const payload = { fields: { [visibleId]: 'visible', [hiddenId]: 'denied' } };
        expect((await getError(() => submit(payload)))?.status).toBe(403);
        await expectNoRecords();
        await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: false });
        expect((await getError(() => submit(payload)))?.status).toBe(403);
        await expectNoRecords();
      }
    );

    it('revokes hidden-field authority after a successful shared submission', async () => {
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      const payload = { fields: { [visibleId]: 'visible', [hiddenId]: 'previously authorized' } };
      const accepted = await submit(payload);
      expect(accepted.status).toBe(201);
      expectEngine(accepted.headers, true);
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: false });
      expect((await getError(() => submit(payload)))?.status).toBe(403);
      expect((await getRecords(fixture.id)).records.map(({ id }) => id)).toEqual([
        accepted.data.id,
      ]);
    });

    it('ignores body and query authority flags instead of authorizing hidden input', async () => {
      const authorizedView = await createView(fixture.id, {
        type: ViewType.Form,
        name: 'Another shared form',
      });
      const authorizedShareId = (
        await enableShareView({ tableId: fixture.id, viewId: authorizedView.id })
      ).data.shareId;
      await updateViewShareMeta(fixture.id, authorizedView.id, { includeHiddenField: true });
      for (const authority of [
        { shareId: authorizedShareId },
        { includeHiddenField: true },
        { allowHiddenFields: true },
        {
          options: {
            shareId: authorizedShareId,
            includeHiddenField: true,
            allowHiddenFields: true,
          },
        },
        { viewId: authorizedView.id },
      ]) {
        const payload = { fields: { [visibleId]: 'visible', [hiddenId]: 'not authorized' } };
        expect((await getError(() => submit({ ...payload, ...authority })))?.status).toBe(403);
        await expectNoRecords();
        expect((await getError(() => submit(payload, authority)))?.status).toBe(403);
        await expectNoRecords();
      }
    });

    it('does not lend shared-view authority to ordinary owner form-submit on the same view', async () => {
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      const fields = { [visibleId]: 'owner visible', [hiddenId]: 'owner hidden' };
      for (const extra of [
        {},
        { shareId: publicShareId, includeHiddenField: true },
        { allowHiddenFields: true, options: { shareId: publicShareId } },
      ]) {
        const error = await getError(() =>
          axios.post(urlBuilder(FORM_SUBMIT, { tableId: fixture.id }), { viewId, fields, ...extra })
        );
        expect(error?.status).toBe(403);
        await expectNoRecords();
      }
      const response = await submit({ fields });
      expectEngine(response.headers, true);
      expect((await getRecord(fixture.id, response.data.id)).fields).toMatchObject(fields);
    });

    it('keeps the authenticated shared view authoritative over submitted viewId and tableId', async () => {
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      const foreign = await createTable(baseId, {
        name: 'Foreign form table',
        fields: [{ name: 'Foreign', type: FieldType.SingleLineText }],
        records: [],
      });
      otherTables.push(foreign.id);
      const foreignForm = await createView(foreign.id, {
        type: ViewType.Form,
        name: 'Foreign form',
      });
      const fields = { [visibleId]: 'actual table', [hiddenId]: 'actual hidden' };
      const response = await submit({ fields, viewId: foreignForm.id, tableId: foreign.id });
      expectEngine(response.headers, true);
      expect((await getRecord(fixture.id, response.data.id)).fields).toMatchObject(fields);
      expect((await getRecords(foreign.id)).records).toHaveLength(0);
      const before = (await getRecords(fixture.id)).records.map(({ id }) => id);
      const error = await getError(() =>
        axios.post(urlBuilder(FORM_SUBMIT, { tableId: fixture.id }), {
          viewId: foreignForm.id,
          fields: { [visibleId]: 'wrong form owner' },
        })
      );
      expect(error?.status).toBe(404);
      expect((await getRecords(fixture.id)).records.map(({ id }) => id)).toEqual(before);
      expect((await getRecords(foreign.id)).records).toHaveLength(0);
    });

    it('rejects unknown and foreign field IDs without writing either table', async () => {
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      const foreign = await createTable(baseId, {
        name: 'Foreign field table',
        fields: [{ name: 'Foreign', type: FieldType.SingleLineText }],
        records: [],
      });
      otherTables.push(foreign.id);
      for (const v2 of [false, true]) {
        process.env.FORCE_V2_ALL = String(v2);
        for (const invalidId of [generateFieldId(), foreign.fields[0].id]) {
          const error = await getError(() =>
            submit({
              fields: { [visibleId]: 'valid', [hiddenId]: 'valid', [invalidId]: 'invalid' },
            })
          );
          expect(error?.status).toBe(403);
          await expectNoRecords();
          expect((await getRecords(foreign.id)).records).toHaveLength(0);
        }
      }
    });

    it('requires visible values without treating zero or false as missing or requiring hidden fields', async () => {
      const count = await createField(fixture.id, { name: 'Count', type: FieldType.Number });
      const checked = await createField(fixture.id, { name: 'Checked', type: FieldType.Checkbox });
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      await updateViewColumnMeta(fixture.id, viewId, [
        { fieldId: count.id, columnMeta: { visible: true, required: true } },
        { fieldId: checked.id, columnMeta: { visible: true, required: true } },
        { fieldId: hiddenId, columnMeta: { visible: false, required: true } },
      ]);
      for (const fields of [
        { [count.id]: 0 },
        { [checked.id]: false },
        { [count.id]: null, [checked.id]: false },
        { [count.id]: 0, [checked.id]: null },
      ]) {
        expect((await getError(() => submit({ fields, typecast: false })))?.status).toBe(400);
        await expectNoRecords();
      }
      const payload = {
        fields: { [visibleId]: 'falsey values', [count.id]: 0, [checked.id]: false },
        typecast: false,
      };
      process.env.FORCE_V2_ALL = 'false';
      const legacy = await submit(payload);
      expectEngine(legacy.headers, false);
      const legacyRecord = await getRecord(fixture.id, legacy.data.id);
      process.env.FORCE_V2_ALL = 'true';
      const response = await submit(payload);
      expectEngine(response.headers, true);
      const persisted = await getRecord(fixture.id, response.data.id);
      expect(response.data.fields).toEqual(persisted.fields);
      expect(persisted.fields[count.id]).toBe(0);
      expect(persisted.fields[checked.id]).toEqual(legacyRecord.fields[checked.id]);
      expect(persisted.fields[hiddenId]).toEqual(legacyRecord.fields[hiddenId]);
      expect(persisted.fields[hiddenId] ?? null).toBeNull();
    });

    it('records the existing v1 versus v2 visible-required difference explicitly', async () => {
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      await updateViewColumnMeta(fixture.id, viewId, [
        { fieldId: visibleId, columnMeta: { visible: true, required: true } },
      ]);
      const payload = { fields: { [hiddenId]: 'required differential' } };
      process.env.FORCE_V2_ALL = 'false';
      const legacy = await submit(payload);
      expect(legacy.status).toBe(201);
      expectEngine(legacy.headers, false);
      expect((await getRecord(fixture.id, legacy.data.id)).fields[hiddenId]).toBe(
        'required differential'
      );
      process.env.FORCE_V2_ALL = 'true';
      expect((await getError(() => submit(payload)))?.status).toBe(400);
      expect((await getRecords(fixture.id)).records.map(({ id }) => id)).toEqual([legacy.data.id]);
    });

    it('preserves v1 typecast behavior and persisted values for authorized hidden numeric input', async () => {
      const count = await createField(fixture.id, { name: 'Hidden count', type: FieldType.Number });
      await updateViewColumnMeta(fixture.id, viewId, [
        { fieldId: count.id, columnMeta: { visible: false } },
      ]);
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      const payload = { fields: { [visibleId]: 'typed', [count.id]: '42' }, typecast: true };
      const stored = [];
      for (const v2 of [false, true]) {
        process.env.FORCE_V2_ALL = String(v2);
        const response = await submit(payload);
        expect(response.status).toBe(201);
        expectEngine(response.headers, v2);
        const record = await getRecord(fixture.id, response.data.id);
        expect(record.fields).toMatchObject({ [visibleId]: 'typed', [count.id]: 42 });
        expect(response.data.fields).toEqual(record.fields);
        stored.push(record.fields[count.id]);
        const before = (await getRecords(fixture.id)).records.map(({ id }) => id);
        expect((await getError(() => submit({ ...payload, typecast: false })))?.status).toBe(400);
        expect((await getRecords(fixture.id)).records.map(({ id }) => id)).toEqual(before);
      }
      expect(stored[1]).toEqual(stored[0]);
    });

    it('preserves v1 computed and read-only cell handling instead of storing supplied values', async () => {
      const formula = await createField(fixture.id, {
        name: 'Calculated',
        type: FieldType.Formula,
        options: { expression: '1+1' },
      });
      const createdTime = await createField(fixture.id, {
        name: 'Created',
        type: FieldType.CreatedTime,
      });
      await updateViewColumnMeta(fixture.id, viewId, [
        { fieldId: formula.id, columnMeta: { visible: false, required: true } },
        { fieldId: createdTime.id, columnMeta: { visible: false } },
      ]);
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      const payload = {
        fields: {
          [visibleId]: 'computed input',
          [hiddenId]: 'ordinary hidden',
          [formula.id]: 999,
          [createdTime.id]: '2000-01-01T00:00:00.000Z',
        },
        typecast: true,
      };
      const stored = [];
      for (const v2 of [false, true]) {
        process.env.FORCE_V2_ALL = String(v2);
        const response = await submit(payload);
        expect(response.status).toBe(201);
        expectEngine(response.headers, v2);
        const record = await getRecord(fixture.id, response.data.id);
        expect(record.fields).toMatchObject({
          [visibleId]: 'computed input',
          [hiddenId]: 'ordinary hidden',
          [formula.id]: 2,
        });
        expect(record.fields[createdTime.id]).toBe(record.createdTime);
        expect(record.fields[createdTime.id]).not.toBe(payload.fields[createdTime.id]);
        expect(response.data.fields).toEqual(record.fields);
        stored.push(record.fields[formula.id]);
      }
      expect(stored[1]).toEqual(stored[0]);
    });

    it('requires the current share password and rejects a cookie issued for another share', async () => {
      await updateViewShareMeta(fixture.id, viewId, {
        includeHiddenField: true,
        password: 'T8457 protected form',
      });
      const payload = {
        fields: { [visibleId]: 'password accepted', [hiddenId]: 'protected hidden' },
      };
      expect((await getError(() => submit(payload)))?.status).toBe(401);
      await expectNoRecords();
      const otherView = await createView(fixture.id, {
        type: ViewType.Form,
        name: 'Other password',
      });
      const otherShareId = (await enableShareView({ tableId: fixture.id, viewId: otherView.id }))
        .data.shareId;
      await updateViewShareMeta(fixture.id, otherView.id, { password: 'T8457 another password' });
      const otherAuth = await anonymousUser.post(
        urlBuilder(SHARE_VIEW_AUTH, { shareId: otherShareId }),
        {
          password: 'T8457 another password',
        }
      );
      const otherCookie = ([] as string[])
        .concat(otherAuth.headers['set-cookie'] ?? [])
        .map((entry) => entry.split(';')[0])
        .find((entry) => entry.startsWith(`${otherShareId}=`));
      expect(otherCookie).toBeDefined();
      const token = otherCookie!.slice(otherShareId.length + 1);
      const error = await getError(() =>
        anonymousUser.post(
          urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId: publicShareId }),
          payload,
          { headers: { cookie: `${publicShareId}=${token}` } }
        )
      );
      expect(error?.status).toBe(401);
      await expectNoRecords();
      const auth = await anonymousUser.post(
        urlBuilder(SHARE_VIEW_AUTH, { shareId: publicShareId }),
        {
          password: 'T8457 protected form',
        }
      );
      const response = await anonymousUser.post(
        urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId: publicShareId }),
        payload,
        { headers: { cookie: auth.headers['set-cookie'] } }
      );
      expectEngine(response.headers, true);
      expect((await getRecord(fixture.id, response.data.id)).fields).toMatchObject(payload.fields);
    });

    it('requires login without rejecting an authenticated hidden-field submission', async () => {
      await updateViewShareMeta(fixture.id, viewId, {
        includeHiddenField: true,
        submit: { requireLogin: true },
      });
      const payload = { fields: { [visibleId]: 'signed in', [hiddenId]: 'signed-in hidden' } };
      expect((await getError(() => submit(payload)))?.status).toBe(401);
      await expectNoRecords();
      const response = await axios.post(
        urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId: publicShareId }),
        payload
      );
      expectEngine(response.headers, true);
      const record = await getRecord(fixture.id, response.data.id);
      expect(record.fields).toMatchObject(payload.fields);
      expect(record.createdBy).not.toBe(ANONYMOUS_USER_ID);
    });

    it('rejects a disabled share without writing a record', async () => {
      await updateViewShareMeta(fixture.id, viewId, { includeHiddenField: true });
      await disableShareView({ tableId: fixture.id, viewId });
      const error = await getError(() =>
        submit({
          fields: { [visibleId]: 'disabled', [hiddenId]: 'must not persist' },
        })
      );
      expect(error?.status).toBe(400);
      await expectNoRecords();
    });

    it('does not let a grid share borrow form ownership from the request body', async () => {
      const grid = fixture.views.find(({ type }) => type === ViewType.Grid)!;
      publicShareId = (await enableShareView({ tableId: fixture.id, viewId: grid.id })).data
        .shareId;
      await updateViewShareMeta(fixture.id, grid.id, { includeHiddenField: true });
      expect(
        (
          await getError(() =>
            submit({
              viewId,
              fields: { [visibleId]: 'not a form', [hiddenId]: 'not allowed' },
            })
          )
        )?.status
      ).toBe(403);
      await expectNoRecords();
    });
  });
});
