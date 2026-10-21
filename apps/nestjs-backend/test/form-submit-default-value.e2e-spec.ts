import type { INestApplication } from '@nestjs/common';
import type { IViewVo } from '@teable/core';
import { FieldKeyType, FieldType, ViewType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { formSubmit } from '@teable/openapi';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { getError } from './utils/get-error';
import {
  convertField,
  createBase,
  createSpace,
  createTable,
  createView,
  getFields,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
  updateViewColumnMeta,
} from './utils/init-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * T7731: a form submission may leave out a not-null field that carries a
 * default value — the created record must take that default. The form-level
 * required switch stays authoritative and still rejects the omission.
 */
describe('Form submit field default value (e2e) T7731', () => {
  let app: INestApplication;
  let spaceId: string;
  let baseId: string;
  let table: ITableFullVo;
  let formView: IViewVo;
  let strictFormView: IViewVo;
  let titleFieldId: string;
  let deptFieldId: string;
  let countFieldId: string;

  const deptDefault = 'default-dept';
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';

    const appCtx = await initApp();
    app = appCtx.app;

    const space = await createSpace({ name: `form-default-${Date.now()}` });
    spaceId = space.id;
    const base = await createBase({ spaceId, name: `form-default-base-${Date.now()}` });
    baseId = base.id;

    table = await createTable(baseId, {
      name: 'form-default-table',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Dept', type: FieldType.SingleLineText, options: { defaultValue: deptDefault } },
        // A falsy default that both engines still write into the record.
        {
          name: 'Count',
          type: FieldType.Number,
          options: { defaultValue: 0 },
          notNull: true,
        },
      ],
      views: [{ name: 'Grid', type: ViewType.Grid }],
      records: [],
    });

    titleFieldId = table.fields.find(({ name }) => name === 'Title')!.id;
    const deptField = table.fields.find(({ name }) => name === 'Dept')!;
    deptFieldId = deptField.id;
    const countField = table.fields.find(({ name }) => name === 'Count')!;
    countFieldId = countField.id;
    expect(countField.notNull).toBe(true);

    // The reported shape: the field is required (notNull) and carries a default value.
    const deptRequired = await convertField(table.id, deptFieldId, {
      name: deptField.name,
      dbFieldName: deptField.dbFieldName,
      type: FieldType.SingleLineText,
      options: { defaultValue: deptDefault },
      notNull: true,
    });
    expect(deptRequired.notNull).toBe(true);

    formView = await createView(table.id, { type: ViewType.Form, name: 'Form' });
    // The repro shape: both fields are visible in the form, so the fill page
    // shows the empty required field.
    const formFields = await getFields(table.id, formView.id, true, [
      titleFieldId,
      deptFieldId,
      countFieldId,
    ]);
    expect(formFields.map(({ id }) => id).sort()).toEqual(
      [deptFieldId, titleFieldId, countFieldId].sort()
    );

    // Second form, used only by the form-required test, so the two cases do not
    // share the column meta they write.
    strictFormView = await createView(table.id, { type: ViewType.Form, name: 'Strict form' });
    await updateViewColumnMeta(table.id, strictFormView.id, [
      { fieldId: deptFieldId, columnMeta: { required: true } },
    ]);
  });

  afterAll(async () => {
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
    await app?.close();
  });

  it('fills the field default when the form leaves a required field empty', async () => {
    const created = await formSubmit(table.id, {
      viewId: formView.id,
      fields: { [titleFieldId]: 'filled' },
    });

    expect(created.status).toBe(201);
    expect(created.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(created.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    expect(created.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('formSubmit');
    expect(created.data.fields[deptFieldId]).toBe(deptDefault);
    expect(created.data.fields[countFieldId]).toBe(0);

    const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    const stored = records.find(({ id }) => id === created.data.id);
    expect(stored?.fields[deptFieldId]).toBe(deptDefault);
    expect(stored?.fields[countFieldId]).toBe(0);
  });

  it('rejects the omission once the form marks the field required', async () => {
    const error = await getError(() =>
      formSubmit(table.id, {
        viewId: strictFormView.id,
        fields: { [titleFieldId]: 'filled-again' },
      })
    );
    expect(error?.status).toBe(400);
    expect(JSON.stringify(error?.data)).toContain('view.required_fields_missing');

    const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(records.some(({ fields }) => fields[titleFieldId] === 'filled-again')).toBe(false);
  });
});
