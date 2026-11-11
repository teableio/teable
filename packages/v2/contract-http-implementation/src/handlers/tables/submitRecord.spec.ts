import { randomUUID } from 'node:crypto';

import {
  ActorId,
  BaseId,
  FieldName,
  RecordWriteSideEffectService,
  SubmitRecordHandler,
  Table,
  TableName,
  ViewColumnMeta,
  createFormView,
  err,
  ok,
  type ICommandBus,
  type IExecutionContext,
  type IRecordCreationInput,
  type IRecordCreationResult,
  type RecordCreationService,
  type SubmitRecordCommand,
  type TableQueryService,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { executeSubmitRecordEndpoint } from './submitRecord';

const setup = () => {
  const shareId = randomUUID();
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Event registration')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Contact name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Campaign source')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  const initial = builder.build()._unsafeUnwrap();
  const [visibleFieldId, hiddenFieldId] = initial.getFields().map((field) => field.id().toString());
  const created = initial
    .createView({
      type: 'form',
      name: 'Registration form',
      enableShare: true,
      shareId,
      shareMeta: { includeHiddenField: true },
    })
    ._unsafeUnwrap();
  // Model a saved form after hiding a field; createView preserves default-visible fields.
  const form = createFormView({
    id: created.view.id(),
    name: created.view.name(),
    properties: created.view.properties(),
  })._unsafeUnwrap();
  form
    .setColumnMeta(
      ViewColumnMeta.rehydrate({
        [visibleFieldId]: { visible: true, required: true },
        [hiddenFieldId]: { visible: false, required: true },
      })._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  form.setQueryDefaults(created.view.queryDefaults()._unsafeUnwrap())._unsafeUnwrap();
  form.setOptions(created.view.options())._unsafeUnwrap();
  const table = Table.rehydrate({
    id: initial.id(),
    baseId: initial.baseId(),
    name: initial.name(),
    fields: initial.getFields(),
    primaryFieldId: initial.primaryFieldId(),
    views: [...initial.views(), form],
  })._unsafeUnwrap();
  const records = new Map<string, Record<string, unknown>>();
  const create = async (_context: IExecutionContext, input: IRecordCreationInput) => {
    const result = input.table.createRecord(input.fieldValues, {
      typecast: input.typecast,
      source: input.source,
    });
    if (result.isErr()) return err(result.error);
    records.set(
      result.value.record.id().toString(),
      Object.fromEntries(
        result.value.record
          .fields()
          .entries()
          .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
      )
    );
    return ok({
      record: result.value.record,
      events: [],
      fieldKeyMapping: new Map(),
    } satisfies IRecordCreationResult);
  };
  const handler = new SubmitRecordHandler(
    { getById: async () => ok(table) } as unknown as TableQueryService,
    { create } as unknown as RecordCreationService,
    new RecordWriteSideEffectService()
  );
  const execute = (context: IExecutionContext, command: SubmitRecordCommand) =>
    handler.handle(context, command);
  return {
    context: { actorId: ActorId.create('system')._unsafeUnwrap() },
    shareId,
    visibleFieldId,
    hiddenFieldId,
    records,
    bus: { execute } as unknown as ICommandBus,
    input: {
      tableId: table.id().toString(),
      formId: created.view.id().toString(),
      fields: { [visibleFieldId]: 'Lin Chen', [hiddenFieldId]: 'autumn-newsletter' },
      typecast: true,
    },
  };
};

describe('executeSubmitRecordEndpoint share authority boundary', () => {
  it.each(['ordinary', 'spoofed'] as const)('rejects %s raw hidden-field input', async (mode) => {
    const test = setup();
    const input = {
      ...test.input,
      ...(mode === 'spoofed'
        ? {
            shareId: test.shareId,
            includeHiddenField: true,
            options: { shareId: test.shareId },
          }
        : {}),
    };

    const result = await executeSubmitRecordEndpoint(test.context, input, test.bus);

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: 'view.hidden_fields_submission_not_allowed' },
    });
    expect(test.records.size).toBe(0);
  });

  it('uses only server identity to authorize and retain hidden values', async () => {
    const test = setup();

    const result = await executeSubmitRecordEndpoint(
      test.context,
      { ...test.input, shareId: randomUUID(), options: { shareId: randomUUID() } },
      test.bus,
      { shareId: test.shareId }
    );

    expect(result.status).toBe(201);
    if (!result.body.ok) throw new Error('Expected successful form submission');
    expect(result.body.data.record.fields[test.hiddenFieldId]).toBe('autumn-newsletter');
    expect(test.records.get(result.body.data.record.id)).toEqual({
      [test.visibleFieldId]: 'Lin Chen',
      [test.hiddenFieldId]: 'autumn-newsletter',
    });
  });

  it('does not make hidden required metadata mandatory for authorized visible-only input', async () => {
    const test = setup();
    const result = await executeSubmitRecordEndpoint(
      test.context,
      { ...test.input, fields: { [test.visibleFieldId]: 'Lin Chen' } },
      test.bus,
      { shareId: test.shareId }
    );

    expect(result.status).toBe(201);
    if (!result.body.ok) throw new Error('Expected successful form submission');
    expect(test.records.get(result.body.data.record.id)?.[test.visibleFieldId]).toBe('Lin Chen');
  });

  it('keeps visible required validation before native creation', async () => {
    const test = setup();
    const result = await executeSubmitRecordEndpoint(
      test.context,
      { ...test.input, fields: { [test.hiddenFieldId]: 'autumn-newsletter' } },
      test.bus,
      { shareId: test.shareId }
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: 'view.required_fields_missing' },
    });
    expect(test.records.size).toBe(0);
  });

  it('rejects unknown fields even when server identity matches', async () => {
    const test = setup();
    const result = await executeSubmitRecordEndpoint(
      test.context,
      { ...test.input, fields: { ...test.input.fields, [`fld${'z'.repeat(16)}`]: 'unknown' } },
      test.bus,
      { shareId: test.shareId }
    );

    expect(result.status).toBe(403);
    expect(test.records.size).toBe(0);
  });
});
