import { randomUUID } from 'node:crypto';

import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type {
  IRecordCreationInput,
  IRecordCreationResult,
  RecordCreationService,
} from '../application/services/RecordCreationService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import type { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewColumnMeta } from '../domain/table/views/ViewColumnMeta';
import { ViewProperties, type ViewPropertiesValue } from '../domain/table/views/ViewProperties';
import { CloneViewVisitor } from '../domain/table/views/visitors/CloneViewVisitor';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableSchemaCoordination } from '../ports/TableSchemaCoordination';
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
  const selectFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();

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
    .singleSelect()
    .withId(selectFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([SelectOption.create({ name: 'Open', color: 'blue' })._unsafeUnwrap()])
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
    selectFieldId: selectFieldId.toString(),
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

const withSharedForm = (
  table: Table,
  formViewId: string,
  hiddenFieldId: string,
  properties: ViewPropertiesValue
): Table => {
  const views = table.views().map((view) => {
    if (view.id().toString() !== formViewId) return view;
    const clone = view
      .accept(
        new CloneViewVisitor({ properties: ViewProperties.create(properties)._unsafeUnwrap() })
      )
      ._unsafeUnwrap();
    clone
      .setColumnMeta(
        ViewColumnMeta.create({
          ...view.columnMeta()._unsafeUnwrap().toDto(),
          [hiddenFieldId]: { visible: false, required: true },
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    clone.setQueryDefaults(view.queryDefaults()._unsafeUnwrap())._unsafeUnwrap();
    return clone;
  });
  return Table.rehydrate({
    id: table.id(),
    baseId: table.baseId(),
    name: table.name(),
    fields: table.getFields(),
    views,
    primaryFieldId: table.primaryFieldId(),
  })._unsafeUnwrap();
};

describe('SubmitRecordHandler', () => {
  it.each(['ordinary', 'spoofed', 'disabled', 'permission-off', 'rotated', 'unknown'] as const)(
    'never creates a record for invalid %s hidden submission',
    async (mode) => {
      const fixture = createTestTable();
      const shareId = randomUUID();
      const table = withSharedForm(fixture.table, fixture.formViewId, fixture.selectFieldId, {
        enableShare: mode !== 'disabled',
        shareId: mode === 'rotated' ? randomUUID() : shareId,
        shareMeta: { includeHiddenField: mode !== 'permission-off' },
      });
      const create = vi.fn();
      const handler = new SubmitRecordHandler(
        { getById: async () => ok(table) } as unknown as TableQueryService,
        { create } as unknown as RecordCreationService,
        new RecordWriteSideEffectService()
      );
      const command = SubmitRecordCommand.create(
        {
          tableId: table.id().toString(),
          formId: fixture.formViewId,
          fields: { [mode === 'unknown' ? `fld${'z'.repeat(16)}` : fixture.selectFieldId]: 'Open' },
          ...(mode === 'spoofed'
            ? { shareId, includeHiddenField: true, options: { shareId } }
            : {}),
        },
        mode === 'ordinary' || mode === 'spoofed' ? undefined : { shareId }
      )._unsafeUnwrap();

      const result = await handler.handle(createContext(), command);

      expect(result._unsafeUnwrapErr().code).toBe('view.hidden_fields_submission_not_allowed');
      expect(create).not.toHaveBeenCalled();
    }
  );

  it('rechecks share permission on the table reloaded for exclusive coordination', async () => {
    const fixture = createTestTable();
    const shareId = randomUUID();
    const initial = withSharedForm(fixture.table, fixture.formViewId, fixture.selectFieldId, {
      enableShare: true,
      shareId,
      shareMeta: { includeHiddenField: true },
    });
    const reloaded = withSharedForm(initial, fixture.formViewId, fixture.selectFieldId, {
      enableShare: true,
      shareId: randomUUID(),
      shareMeta: { includeHiddenField: true },
    });
    const getById = vi.fn().mockResolvedValueOnce(ok(initial)).mockResolvedValueOnce(ok(reloaded));
    const create = vi.fn();
    const events: string[] = [];
    const handler = new SubmitRecordHandler(
      { getById } as unknown as TableQueryService,
      { create } as unknown as RecordCreationService,
      new RecordWriteSideEffectService(),
      {
        acquire: async (_context, tableIds, mode) => {
          events.push(mode);
          return ok({
            mode,
            tableIds,
            release: async () => {
              events.push(`release-${mode}`);
            },
          });
        },
      }
    );
    const command = SubmitRecordCommand.create(
      {
        tableId: initial.id().toString(),
        formId: fixture.formViewId,
        fields: { [fixture.selectFieldId]: 'New option' },
        typecast: true,
      },
      { shareId }
    )._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().code).toBe('view.hidden_fields_submission_not_allowed');
    expect(getById).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    expect(events).toEqual(['shared', 'release-shared', 'exclusive', 'release-exclusive']);
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

    const handler = new SubmitRecordHandler(
      tableQueryService,
      recordCreationService,
      new RecordWriteSideEffectService()
    );
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

    const handler = new SubmitRecordHandler(
      tableQueryService,
      recordCreationService,
      new RecordWriteSideEffectService()
    );
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

    const handler = new SubmitRecordHandler(
      tableQueryService,
      recordCreationService,
      new RecordWriteSideEffectService()
    );
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

  it('releases shared and reloads before an exclusive submission', async () => {
    const initial = createTestTable();
    const reloaded = createTestTable();
    const reads: string[] = [];
    const tableQueryService = {
      getById: async () => {
        const table = reads.length === 0 ? initial.table : reloaded.table;
        reads.push(table.id().toString());
        return ok(table);
      },
    } as unknown as TableQueryService;
    const events: string[] = [];
    let executedWith: Table | undefined;
    const recordCreationService = {
      create: async (_context: IExecutionContext, input: IRecordCreationInput) => {
        executedWith = input.table;
        const createResult = input.table.createRecord(
          new Map([[reloaded.textFieldId, 'submitted']]),
          { typecast: false, source: { type: 'form', formId: reloaded.formViewId } }
        );
        if (createResult.isErr()) return err(createResult.error);
        return ok({
          record: createResult.value.record,
          events: [],
          fieldKeyMapping: new Map(),
        } satisfies IRecordCreationResult);
      },
    } as unknown as RecordCreationService;
    const coordination: ITableSchemaCoordination = {
      acquire: async (_context, tableIds, mode) => {
        events.push(mode);
        return ok({
          mode,
          tableIds,
          release: async () => {
            events.push(`release-${mode}`);
          },
        });
      },
    };

    const handler = new SubmitRecordHandler(
      tableQueryService,
      recordCreationService,
      new RecordWriteSideEffectService(),
      coordination
    );
    const command = SubmitRecordCommand.create({
      tableId: reloaded.table.id().toString(),
      formId: reloaded.formViewId,
      fields: { [reloaded.selectFieldId]: 'In Progress' },
      typecast: true,
    })._unsafeUnwrap();
    (await handler.handle(createContext(), command))._unsafeUnwrap();

    expect(events).toEqual(['shared', 'release-shared', 'exclusive', 'release-exclusive']);
    expect(reads).toHaveLength(2);
    expect(executedWith).toBe(reloaded.table);
  });

  it('releases the shared lease when submission creation fails', async () => {
    const { table, textFieldId, formViewId } = createTestTable();
    let readCount = 0;
    const tableQueryService = {
      getById: async () => {
        readCount++;
        return ok(table);
      },
    } as unknown as TableQueryService;
    const recordCreationService = {
      create: async () => err(domainError.unexpected({ message: 'create failed' })),
    } as unknown as RecordCreationService;
    const events: string[] = [];
    const handler = new SubmitRecordHandler(
      tableQueryService,
      recordCreationService,
      new RecordWriteSideEffectService(),
      {
        acquire: async (_context, tableIds, mode) => {
          events.push(mode);
          return ok({
            mode,
            tableIds,
            release: async () => {
              events.push(`release-${mode}`);
            },
          });
        },
      }
    );
    const command = SubmitRecordCommand.create({
      tableId: table.id().toString(),
      formId: formViewId,
      fields: { [textFieldId]: 'value' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(events).toEqual(['shared', 'release-shared']);
    expect(readCount).toBe(1);
  });
});
