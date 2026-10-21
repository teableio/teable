import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { ButtonMaxCount } from '../fields/types/ButtonMaxCount';
import { ButtonResetCount } from '../fields/types/ButtonResetCount';
import { ButtonWorkflow } from '../fields/types/ButtonWorkflow';
import { RecordId } from '../records/RecordId';
import { SetButtonValueSpec } from '../records/specs/values/SetButtonValueSpec';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';

const ids = {
  base: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
  table: TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap(),
  primary: FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap(),
  button: FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap(),
  view: ViewId.create(`viw${'e'.repeat(16)}`)._unsafeUnwrap(),
  record: RecordId.create(`rec${'f'.repeat(16)}`)._unsafeUnwrap(),
};

const buildTable = (options?: {
  active?: boolean;
  workflowId?: string;
  maxCount?: number;
  resetCount?: boolean;
}) => {
  const builder = Table.builder()
    .withBaseId(ids.base)
    .withId(ids.table)
    .withName(TableName.create('Buttons')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(ids.primary)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  const button = builder
    .field()
    .button()
    .withId(ids.button)
    .withName(FieldName.create('Run')._unsafeUnwrap());
  if (options?.workflowId !== undefined || options?.active !== undefined) {
    button.withWorkflow(
      ButtonWorkflow.create({
        id: options.workflowId ?? `wfl${'g'.repeat(16)}`,
        name: 'Run',
        isActive: options.active ?? true,
      })._unsafeUnwrap()
    );
  }
  if (options?.maxCount !== undefined) {
    button.withMaxCount(ButtonMaxCount.create(options.maxCount)._unsafeUnwrap());
  }
  if (options?.resetCount !== undefined) {
    button.withResetCount(ButtonResetCount.create(options.resetCount)._unsafeUnwrap());
  }
  button.done();
  builder.view().grid().withId(ids.view).defaultName().done();
  return builder.build()._unsafeUnwrap();
};

const shareScope = {
  viewId: ids.view,
  includeHiddenFields: false,
  includeRecords: true,
};

describe('Table.createButtonClickPlan', () => {
  it('creates an internal Button mutation and increments an empty value', () => {
    const workflowId = `wfl${'h'.repeat(16)}`;
    const table = buildTable({ active: true, workflowId });
    const plan = table.createButtonClickPlan({ fieldId: ids.button, shareScope })._unsafeUnwrap();
    const update = plan.click(table, ids.record, undefined)._unsafeUnwrap();

    expect(plan.workflowId()).toBe(workflowId);
    expect(update.mutateSpec).toBeInstanceOf(SetButtonValueSpec);
    expect(update.record.fields().get(ids.button)?.toValue()).toEqual({ count: 1 });
  });

  it('increments the stored count', () => {
    const table = buildTable({ active: true });
    const plan = table.createButtonClickPlan({ fieldId: ids.button })._unsafeUnwrap();

    expect(
      plan
        .click(table, ids.record, { count: 4 })
        ._unsafeUnwrap()
        .record.fields()
        .get(ids.button)
        ?.toValue()
    ).toEqual({ count: 5 });
  });

  it('rejects a missing or inactive workflow', () => {
    expect(
      buildTable().createButtonClickPlan({ fieldId: ids.button })._unsafeUnwrapErr()
    ).toMatchObject({ code: 'button.workflow_not_active', tags: ['validation'] });
    expect(
      buildTable({ active: false })
        .createButtonClickPlan({ fieldId: ids.button })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'button.workflow_not_active', tags: ['validation'] });
  });

  it('rejects a non-Button Field', () => {
    expect(
      buildTable({ active: true })
        .createButtonClickPlan({ fieldId: ids.primary })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'button.field_type_invalid', tags: ['validation'] });
  });

  it('rejects a click at the maximum count', () => {
    const table = buildTable({ active: true, maxCount: 2 });
    const plan = table.createButtonClickPlan({ fieldId: ids.button })._unsafeUnwrap();

    expect(plan.click(table, ids.record, { count: 2 })._unsafeUnwrapErr()).toMatchObject({
      code: 'button.click_count_reached_max',
      tags: ['validation'],
    });
  });

  it('rejects shared clicks when records are disabled', () => {
    expect(
      buildTable({ active: true })
        .createButtonClickPlan({
          fieldId: ids.button,
          shareScope: { ...shareScope, includeRecords: false },
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'button.shared_records_disabled', tags: ['forbidden'] });
  });

  it('rejects a hidden shared Button unless hidden Fields are included', () => {
    const table = buildTable({ active: true });
    const hidden = table
      .updateViewColumnMeta(ids.view, [{ fieldId: ids.button, columnMeta: { hidden: true } }])
      ._unsafeUnwrap().updateResult!.table;

    expect(
      hidden.createButtonClickPlan({ fieldId: ids.button, shareScope })._unsafeUnwrapErr()
    ).toMatchObject({ code: 'button.shared_field_hidden', tags: ['forbidden'] });
    expect(
      hidden
        .createButtonClickPlan({
          fieldId: ids.button,
          shareScope: { ...shareScope, includeHiddenFields: true },
        })
        .isOk()
    ).toBe(true);
  });

  it('builds the internal Button mutation used by undo replay', () => {
    const table = buildTable({ active: false });
    const restored = table
      .setButtonValue({
        recordId: ids.record,
        fieldId: ids.button,
        value: { count: 4 },
      })
      ._unsafeUnwrap();

    expect(restored.mutateSpec).toBeInstanceOf(SetButtonValueSpec);
    expect(restored.record.fields().get(ids.button)?.toValue()).toEqual({ count: 4 });
  });
});

describe('Table.resetButtonValue', () => {
  it('creates an internal null mutation when resetCount is enabled', () => {
    const reset = buildTable({ resetCount: true })
      .resetButtonValue({ recordId: ids.record, fieldId: ids.button })
      ._unsafeUnwrap();

    expect(reset.mutateSpec).toBeInstanceOf(SetButtonValueSpec);
    expect(reset.record.fields().get(ids.button)?.toValue()).toBeNull();
  });

  it('rejects reset when resetCount is absent or false', () => {
    expect(
      buildTable()
        .resetButtonValue({ recordId: ids.record, fieldId: ids.button })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'button.reset_not_supported', tags: ['validation'] });
    expect(
      buildTable({ resetCount: false })
        .resetButtonValue({ recordId: ids.record, fieldId: ids.button })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'button.reset_not_supported', tags: ['validation'] });
  });

  it('rejects reset for a non-Button Field', () => {
    expect(
      buildTable({ resetCount: true })
        .resetButtonValue({ recordId: ids.record, fieldId: ids.primary })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'button.field_type_invalid', tags: ['validation'] });
  });
});
