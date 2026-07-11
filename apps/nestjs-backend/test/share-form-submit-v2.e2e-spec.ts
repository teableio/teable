import type { INestApplication } from '@nestjs/common';
import { FieldType, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import {
  SHARE_VIEW_FORM_SUBMIT,
  SettingKey,
  enableShareView,
  updateSetting,
  updateViewColumnMeta,
  updateViewShareMeta,
  urlBuilder,
} from '@teable/openapi';
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
  let anonymousUser: ReturnType<typeof createAnonymousUserAxios>;
  let previousForceV2All: string | undefined;
  let previousEnableCanaryFeature: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    previousEnableCanaryFeature = process.env.ENABLE_CANARY_FEATURE;
    process.env.FORCE_V2_ALL = 'false';
    process.env.ENABLE_CANARY_FEATURE = 'true';

    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    anonymousUser = createAnonymousUserAxios(appCtx.appUrl);

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
      [SettingKey.CANARY_CONFIG]: { enabled: false, spaceIds: [] },
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

  afterEach(async () => {
    process.env.FORCE_V2_ALL = 'false';
    await updateSetting({
      [SettingKey.CANARY_CONFIG]: { enabled: false, spaceIds: [] },
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
        spaceIds: ['spcNotThisSpace'],
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

  it('should allow hidden fields when share includeHiddenField is true (T6145)', async () => {
    process.env.FORCE_V2_ALL = 'true';

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
          [nameFieldId]: `T6145-hidden-allowed-${Date.now()}`,
          [extraField.id]: 'hidden-value',
        },
        typecast: true,
      });

      expect(res.status).toBe(201);
      // V2 does not yet support includeHiddenField; share falls back to V1.
      expect(res.headers[X_TEABLE_V2_HEADER]).toBe('false');
      expect(res.headers[X_TEABLE_V2_REASON_HEADER]).toBe('unsupported_feature');
    } finally {
      await updateViewShareMeta(table.id, formViewId, {
        includeHiddenField: false,
      });
    }
  });
});
