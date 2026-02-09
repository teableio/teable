import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type {
  IRecordCreationInput,
  IRecordCreationResult,
} from '../application/services/RecordCreationService';
import { RecordCreationService } from '../application/services/RecordCreationService';
import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import { RecordCreated } from '../domain/table/events/RecordCreated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewColumnMeta } from '../domain/table/views/ViewColumnMeta';
import { CloneViewVisitor } from '../domain/table/views/visitors/CloneViewVisitor';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { SubmitRecordCommand } from './SubmitRecordCommand';
import { SubmitRecordHandler } from './SubmitRecordHandler';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  return { actorId: actorIdResult._unsafeUnwrap() };
};

const createTestTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Submit Form Table')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
  const hiddenFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .button()
    .withId(hiddenFieldId)
    .withName(FieldName.create('Hidden Button')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  builder.view().form().defaultName().done();

  const table = builder.build()._unsafeUnwrap();
  const gridView = table.views().find((view) => view.type().toString() === 'grid');
  const formView = table.views().find((view) => view.type().toString() === 'form');
  if (!gridView || !formView) {
    throw new Error('Expected grid and form views');
  }

  return {
    table,
    textFieldId: textFieldId.toString(),
    hiddenFieldId: hiddenFieldId.toString(),
    gridViewId: gridView.id().toString(),
    formViewId: formView.id().toString(),
  };
};

const withFormRequiredFields = (
  table: Table,
  formViewId: string,
  requiredFieldIds: ReadonlyArray<string>
): Table => {
  const nextViews = table.views().map((view) => {
    const clone = view.accept(new CloneViewVisitor())._unsafeUnwrap();
    const columnMeta = view.columnMeta()._unsafeUnwrap().toDto();

    if (view.id().toString() === formViewId) {
      for (const fieldId of requiredFieldIds) {
        const previous = columnMeta[fieldId] ?? {};
        columnMeta[fieldId] = {
          ...previous,
          visible: true,
          required: true,
        };
      }
    }

    clone.setColumnMeta(ViewColumnMeta.create(columnMeta)._unsafeUnwrap())._unsafeUnwrap();
    clone.setQueryDefaults(view.queryDefaults()._unsafeUnwrap())._unsafeUnwrap();
    return clone;
  });

  return Table.rehydrate({
    id: table.id(),
    baseId: table.baseId(),
    name: table.name(),
    fields: table.getFields(),
    views: nextViews,
    primaryFieldId: table.primaryFieldId(),
  })._unsafeUnwrap();
};

describe('SubmitRecordHandler', () => {
  it('creates record from form with visible fields and propagates form source', async () => {
    const { table, textFieldId, formViewId } = createTestTable();

    let receivedCreateSource:
      | {
          type: 'user';
        }
      | {
          type: 'form';
          formId: string;
        }
      | undefined;

    const tableQueryService = {
      getById: async () => ok(table),
    } as unknown as TableQueryService;

    const recordCreationService = {
      create: async (_context: IExecutionContext, input: IRecordCreationInput) => {
        receivedCreateSource = input.source;
        const createResult = table.createRecord(input.fieldValues, {
          typecast: input.typecast,
          source: input.source,
        });
        if (createResult.isErr()) {
          return err(createResult.error);
        }
        const events = table.pullDomainEvents();
        return ok({
          record: createResult.value.record,
          events,
          fieldKeyMapping: new Map(),
        } satisfies IRecordCreationResult);
      },
    } as unknown as RecordCreationService;

    const handler = new SubmitRecordHandler(tableQueryService, recordCreationService);
    const command = SubmitRecordCommand.create({
      tableId: table.id().toString(),
      formId: formViewId,
      fields: {
        [textFieldId]: 'submitted from form',
      },
      typecast: false,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const value = result._unsafeUnwrap();

    expect(receivedCreateSource).toEqual({
      type: 'form',
      formId: formViewId,
    });

    const createdEvent = value.events.find(
      (event): event is RecordCreated => event instanceof RecordCreated
    );
    expect(createdEvent).toBeDefined();
    expect(createdEvent?.source).toEqual({ type: 'form', formId: formViewId });
  });

  it('rejects when view is not a form', async () => {
    const { table, textFieldId, gridViewId } = createTestTable();

    let createCalled = false;

    const tableQueryService = {
      getById: async () => ok(table),
    } as unknown as TableQueryService;

    const recordCreationService = {
      create: async (): Promise<Result<IRecordCreationResult, DomainError>> => {
        createCalled = true;
        throw new Error('should not be called');
      },
    } as unknown as RecordCreationService;

    const handler = new SubmitRecordHandler(tableQueryService, recordCreationService);
    const command = SubmitRecordCommand.create({
      tableId: table.id().toString(),
      formId: gridViewId,
      fields: {
        [textFieldId]: 'invalid',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const error = result._unsafeUnwrapErr();

    expect(createCalled).toBe(false);
    expect(error.tags).toContain('forbidden');
    expect(error.code).toBe('view.type_not_form');
  });

  it('rejects when submitted fields include hidden/non-visible form fields', async () => {
    const { table, hiddenFieldId, formViewId } = createTestTable();

    let createCalled = false;

    const tableQueryService = {
      getById: async () => ok(table),
    } as unknown as TableQueryService;

    const recordCreationService = {
      create: async (): Promise<Result<IRecordCreationResult, DomainError>> => {
        createCalled = true;
        throw new Error('should not be called');
      },
    } as unknown as RecordCreationService;

    const handler = new SubmitRecordHandler(tableQueryService, recordCreationService);
    const command = SubmitRecordCommand.create({
      tableId: table.id().toString(),
      formId: formViewId,
      fields: {
        [hiddenFieldId]: 'should be blocked',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const error = result._unsafeUnwrapErr();

    expect(createCalled).toBe(false);
    expect(error.tags).toContain('forbidden');
    expect(error.code).toBe('view.hidden_fields_submission_not_allowed');
  });

  it('rejects when required form fields are missing', async () => {
    const { table, textFieldId, formViewId } = createTestTable();
    const tableWithRequiredField = withFormRequiredFields(table, formViewId, [textFieldId]);

    let createCalled = false;

    const tableQueryService = {
      getById: async () => ok(tableWithRequiredField),
    } as unknown as TableQueryService;

    const recordCreationService = {
      create: async (): Promise<Result<IRecordCreationResult, DomainError>> => {
        createCalled = true;
        throw new Error('should not be called');
      },
    } as unknown as RecordCreationService;

    const handler = new SubmitRecordHandler(tableQueryService, recordCreationService);
    const command = SubmitRecordCommand.create({
      tableId: tableWithRequiredField.id().toString(),
      formId: formViewId,
      fields: {},
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const error = result._unsafeUnwrapErr();

    expect(createCalled).toBe(false);
    expect(error.tags).toContain('validation');
    expect(error.code).toBe('view.required_fields_missing');
    expect(error.details).toEqual({
      missingFieldIds: [textFieldId],
    });
  });
});
