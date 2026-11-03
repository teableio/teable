import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaseId } from '../base/BaseId';
import { DbFieldName } from './fields/DbFieldName';
import type { Field } from './fields/Field';
import { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { CheckboxDefaultValue } from './fields/types/CheckboxDefaultValue';
import { CheckboxField } from './fields/types/CheckboxField';
import { FieldNotNull } from './fields/types/FieldNotNull';
import { FieldUnique } from './fields/types/FieldUnique';
import { FormulaExpression } from './fields/types/FormulaExpression';
import { FormulaField } from './fields/types/FormulaField';
import { NumberDefaultValue } from './fields/types/NumberDefaultValue';
import { NumberField } from './fields/types/NumberField';
import { SingleLineTextField } from './fields/types/SingleLineTextField';
import { TextDefaultValue } from './fields/types/TextDefaultValue';
import { TableUpdateViewColumnMetaSpec } from './specs/TableUpdateViewColumnMetaSpec';
import { Table } from './Table';
import { TableId } from './TableId';
import { TableName } from './TableName';
import { GridView } from './views/types/GridView';
import {
  ViewColumnMeta,
  type ViewColumnMetaEntry,
  type ViewColumnMetaValue,
} from './views/ViewColumnMeta';
import { ViewId } from './views/ViewId';
import { ViewName } from './views/ViewName';
import { ViewQueryDefaults } from './views/ViewQueryDefaults';

/**
 * Batch field creation (the `TableMutator.addFields` seam) must produce exactly the
 * table that adding the same fields one by one produces. The repeated-single-add
 * result is the oracle; only the number of metadata constructions may change.
 */

const BASE_ID = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const TABLE_ID = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();

const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const viewId = (seed: string) => ViewId.create(`viw${seed.repeat(16)}`)._unsafeUnwrap();
const fieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

type FieldSpec = {
  id: string;
  name: string;
  type?: 'text' | 'number' | 'checkbox';
  primary?: boolean;
  required?: boolean;
  unique?: boolean;
  defaultValue?: string | number | boolean;
};

type ViewSpec = {
  id: string;
  name: string;
  type: 'grid' | 'form' | 'gallery' | 'kanban' | 'calendar' | 'plugin';
};

const buildTable = (params: {
  fields: ReadonlyArray<FieldSpec>;
  views: ReadonlyArray<ViewSpec>;
}): Table => {
  const builder = Table.builder()
    .withId(TABLE_ID)
    .withBaseId(BASE_ID)
    .withName(TableName.create('Batch Fields')._unsafeUnwrap());

  for (const spec of params.fields) {
    if (spec.type === 'number') {
      const numberBuilder = builder
        .field()
        .number()
        .withId(fieldId(spec.id))
        .withName(fieldName(spec.name));
      if (spec.defaultValue !== undefined) {
        numberBuilder.withDefaultValue(
          NumberDefaultValue.create(spec.defaultValue)._unsafeUnwrap()
        );
      }
      if (spec.required) numberBuilder.withNotNull(FieldNotNull.required());
      if (spec.unique) numberBuilder.withUnique(FieldUnique.enabled());
      if (spec.primary) numberBuilder.primary();
      numberBuilder.done();
      continue;
    }

    if (spec.type === 'checkbox') {
      const checkboxBuilder = builder
        .field()
        .checkbox()
        .withId(fieldId(spec.id))
        .withName(fieldName(spec.name));
      if (spec.defaultValue !== undefined) {
        checkboxBuilder.withDefaultValue(
          CheckboxDefaultValue.create(spec.defaultValue)._unsafeUnwrap()
        );
      }
      if (spec.required) checkboxBuilder.withNotNull(FieldNotNull.required());
      if (spec.unique) checkboxBuilder.withUnique(FieldUnique.enabled());
      if (spec.primary) checkboxBuilder.primary();
      checkboxBuilder.done();
      continue;
    }

    const textBuilder = builder
      .field()
      .singleLineText()
      .withId(fieldId(spec.id))
      .withName(fieldName(spec.name));
    if (spec.defaultValue !== undefined) {
      textBuilder.withDefaultValue(TextDefaultValue.create(spec.defaultValue)._unsafeUnwrap());
    }
    if (spec.required) textBuilder.withNotNull(FieldNotNull.required());
    if (spec.unique) textBuilder.withUnique(FieldUnique.enabled());
    if (spec.primary) textBuilder.primary();
    textBuilder.done();
  }

  const viewBuilder = builder.view();
  for (const spec of params.views) {
    const id = viewId(spec.id);
    const name = ViewName.create(spec.name)._unsafeUnwrap();
    switch (spec.type) {
      case 'form':
        viewBuilder.form().withId(id).withName(name).done();
        break;
      case 'gallery':
        viewBuilder.gallery().withId(id).withName(name).done();
        break;
      case 'kanban':
        viewBuilder.kanban().withId(id).withName(name).done();
        break;
      case 'calendar':
        viewBuilder.calendar().withId(id).withName(name).done();
        break;
      case 'plugin':
        viewBuilder.plugin().withId(id).withName(name).done();
        break;
      default:
        viewBuilder.grid().withId(id).withName(name).done();
        break;
    }
  }

  return builder.build()._unsafeUnwrap();
};

/** Replaces a view's whole metadata map, which is how sparse legacy rows arrive. */
const replaceViewColumnMeta = (
  table: Table,
  targetViewId: ViewId,
  columnMeta: ViewColumnMetaValue
): Table =>
  TableUpdateViewColumnMetaSpec.create(table, [
    {
      viewId: targetViewId,
      fieldId: table.primaryFieldId(),
      columnMeta: ViewColumnMeta.create(columnMeta)._unsafeUnwrap(),
    },
  ])
    .mutate(table)
    ._unsafeUnwrap();

/** Applies a partial patch the way the view column metadata command does. */
const patchViewColumnMeta = (
  table: Table,
  targetViewId: ViewId,
  fieldIdValue: FieldId,
  columnMeta: ViewColumnMetaEntry
): Table =>
  table.updateViewColumnMeta(targetViewId, [{ fieldId: fieldIdValue, columnMeta }])._unsafeUnwrap()
    .updateResult!.table;

const viewMetadata = (table: Table) =>
  table.views().map((view) => ({
    type: view.type().toString(),
    name: view.name().toString(),
    columnMeta: view.columnMeta()._unsafeUnwrap().toDto(),
  }));

const columnMetaOf = (table: Table, viewIndex: number): ViewColumnMetaValue => {
  const view = table.views()[viewIndex];
  if (!view) throw new Error(`missing view at index ${viewIndex}`);
  return view.columnMeta()._unsafeUnwrap().toDto();
};

const fieldIdsOf = (table: Table) => table.getFields().map((field) => field.id().toString());

const addSequentially = (table: Table, fields: ReadonlyArray<Field>): Table => {
  let current = table;
  for (const field of fields) {
    current = current.update((mutator) => mutator.addField(field))._unsafeUnwrap().table;
  }
  return current;
};

const makeTextField = (
  seed: string,
  name: string,
  options?: { required?: boolean; unique?: boolean; defaultValue?: string }
): Field => {
  const { defaultValue: rawDefault, required, unique } = options ?? {};
  const field = SingleLineTextField.create({
    id: fieldId(seed),
    name: fieldName(name),
    ...(rawDefault !== undefined
      ? { defaultValue: TextDefaultValue.create(rawDefault)._unsafeUnwrap() }
      : {}),
  })._unsafeUnwrap();
  if (required) field.setNotNull(FieldNotNull.required())._unsafeUnwrap();
  if (unique) field.setUnique(FieldUnique.enabled())._unsafeUnwrap();
  return field;
};

const makeNumberField = (
  seed: string,
  name: string,
  options?: { defaultValue?: number; required?: boolean }
): Field => {
  const { defaultValue: rawDefault, required } = options ?? {};
  const field = NumberField.create({
    id: fieldId(seed),
    name: fieldName(name),
    ...(rawDefault !== undefined
      ? { defaultValue: NumberDefaultValue.create(rawDefault)._unsafeUnwrap() }
      : {}),
  })._unsafeUnwrap();
  if (required) field.setNotNull(FieldNotNull.required())._unsafeUnwrap();
  return field;
};

const makeCheckboxField = (
  seed: string,
  name: string,
  options?: { defaultValue?: boolean; required?: boolean }
): Field => {
  const { defaultValue: rawDefault, required } = options ?? {};
  const field = CheckboxField.create({
    id: fieldId(seed),
    name: fieldName(name),
    ...(rawDefault !== undefined
      ? { defaultValue: CheckboxDefaultValue.create(rawDefault)._unsafeUnwrap() }
      : {}),
  })._unsafeUnwrap();
  if (required) field.setNotNull(FieldNotNull.required())._unsafeUnwrap();
  return field;
};

const makeFormulaField = (seed: string, name: string, expression: string): Field =>
  FormulaField.create({
    id: fieldId(seed),
    name: fieldName(name),
    expression: FormulaExpression.create(expression)._unsafeUnwrap(),
  })._unsafeUnwrap();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Table.addFields', () => {
  it('keeps batch view metadata identical to sequential additions across view types', () => {
    const fixture = {
      fields: [
        { id: 'a', name: 'Title', primary: true },
        { id: 'b', name: 'Notes' },
      ],
      views: [
        { id: 'a', name: 'Grid Hidden', type: 'grid' as const },
        { id: 'b', name: 'Grid Shown', type: 'grid' as const },
        { id: 'c', name: 'Form', type: 'form' as const },
        { id: 'd', name: 'Gallery', type: 'gallery' as const },
        { id: 'e', name: 'Kanban', type: 'kanban' as const },
        { id: 'f', name: 'Calendar', type: 'calendar' as const },
        { id: 'g', name: 'Plugin', type: 'plugin' as const },
      ],
    };
    const notesId = fieldId('b');
    const configure = (table: Table) =>
      patchViewColumnMeta(
        patchViewColumnMeta(
          patchViewColumnMeta(table, viewId('a'), notesId, { hidden: true }),
          viewId('b'),
          notesId,
          { hidden: false }
        ),
        viewId('d'),
        notesId,
        { visible: false }
      );

    const batchSource = configure(buildTable(fixture));
    const sequentialSource = configure(buildTable(fixture));
    const originalMetadata = viewMetadata(batchSource);

    const batch = batchSource
      .update((mutator) =>
        mutator.addFields([makeTextField('h', 'Alpha'), makeNumberField('i', 'Beta')])
      )
      ._unsafeUnwrap().table;
    const sequential = addSequentially(sequentialSource, [
      makeTextField('h', 'Alpha'),
      makeNumberField('i', 'Beta'),
    ]);

    expect(viewMetadata(batch)).toEqual(viewMetadata(sequential));
    expect(fieldIdsOf(batch)).toEqual(fieldIdsOf(sequential));
    expect(viewMetadata(batchSource)).toEqual(originalMetadata);

    const alphaId = fieldId('h').toString();
    const betaId = fieldId('i').toString();
    expect(batch.views().map((view) => view.columnMeta()._unsafeUnwrap().toDto()[alphaId])).toEqual(
      [
        { order: 2, hidden: true },
        { order: 2 },
        { order: 2, visible: true },
        { order: 2, visible: false },
        { order: 2 },
        { order: 2 },
        { order: 2 },
      ]
    );
    expect(batch.views().map((view) => view.columnMeta()._unsafeUnwrap().toDto()[betaId])).toEqual([
      { order: 3, hidden: true },
      { order: 3 },
      { order: 3, visible: true },
      { order: 3, visible: false },
      { order: 3 },
      { order: 3 },
      { order: 3 },
    ]);
  });

  it('hydrates sparse legacy view metadata before appending a batch', () => {
    const fixture = {
      fields: [
        { id: 'a', name: 'Title', primary: true },
        { id: 'c', name: 'Legacy A' },
        { id: 'd', name: 'Legacy B' },
      ],
      views: [{ id: 'a', name: 'Grid', type: 'grid' as const }],
    };
    const staleKey = fieldId('z').toString();
    const sparseMetadata: ViewColumnMetaValue = {
      [fieldId('a').toString()]: { order: 0 },
      [fieldId('c').toString()]: { width: 120 },
      [staleKey]: { order: 5, width: 240 },
    };
    const configure = (table: Table) => replaceViewColumnMeta(table, viewId('a'), sparseMetadata);

    const batchSource = configure(buildTable(fixture));
    const sequentialSource = configure(buildTable(fixture));
    const originalMetadata = viewMetadata(batchSource);

    const batch = batchSource
      .update((mutator) =>
        mutator.addFields([makeTextField('h', 'Alpha'), makeTextField('i', 'Beta')])
      )
      ._unsafeUnwrap().table;
    const sequential = addSequentially(sequentialSource, [
      makeTextField('h', 'Alpha'),
      makeTextField('i', 'Beta'),
    ]);

    expect(viewMetadata(batch)).toEqual(viewMetadata(sequential));
    expect(viewMetadata(batchSource)).toEqual(originalMetadata);

    const metadata = columnMetaOf(batch, 0);
    expect(metadata[fieldId('a').toString()]).toEqual({ order: 0 });
    expect(metadata[fieldId('c').toString()]).toEqual({ order: 6, width: 120 });
    expect(metadata[fieldId('d').toString()]).toEqual({ order: 7 });
    expect(metadata[fieldId('h').toString()]).toEqual({ order: 8 });
    expect(metadata[fieldId('i').toString()]).toEqual({ order: 9 });
    expect(metadata[staleKey]).toEqual({ order: 5, width: 240 });
  });

  it('treats a metadata key for a later batch field as sequential additions do', () => {
    const fixture = {
      fields: [
        { id: 'a', name: 'Title', primary: true },
        { id: 'b', name: 'Notes' },
      ],
      views: [{ id: 'a', name: 'Grid', type: 'grid' as const }],
    };
    const reservedKey = fieldId('i').toString();
    const configure = (table: Table) =>
      replaceViewColumnMeta(table, viewId('a'), {
        [fieldId('a').toString()]: { order: 0 },
        [fieldId('b').toString()]: { order: 1 },
        [reservedKey]: { order: 7, hidden: true },
      });

    const batchSource = configure(buildTable(fixture));
    const sequentialSource = configure(buildTable(fixture));

    const batch = batchSource
      .update((mutator) =>
        mutator.addFields([makeTextField('h', 'Alpha'), makeTextField('i', 'Beta')])
      )
      ._unsafeUnwrap().table;
    const sequential = addSequentially(sequentialSource, [
      makeTextField('h', 'Alpha'),
      makeTextField('i', 'Beta'),
    ]);

    expect(viewMetadata(batch)).toEqual(viewMetadata(sequential));
    // The reserved entry is a hidden column, so the first addition inherits hidden,
    // exactly as the first single-field addition does.
    expect(columnMetaOf(batch, 0)).toMatchObject({
      [fieldId('h').toString()]: { order: 8, hidden: true },
      [reservedKey]: { order: 9, hidden: true },
    });
  });

  it('applies form required/default/unique visibility to a batch like sequential additions', () => {
    const fixture = {
      fields: [
        { id: 'a', name: 'Title', primary: true },
        { id: 'b', name: 'Notes' },
      ],
      views: [
        { id: 'a', name: 'Grid', type: 'grid' as const },
        { id: 'b', name: 'Form', type: 'form' as const },
      ],
    };
    const configure = (table: Table) =>
      patchViewColumnMeta(table, viewId('b'), fieldId('b'), { visible: false });

    const buildFields = (): ReadonlyArray<Field> => [
      makeTextField('h', 'Required Plain', { required: true }),
      makeTextField('i', 'Required Empty Default', { required: true, defaultValue: '' }),
      makeTextField('j', 'Required With Default', { required: true, defaultValue: 'value' }),
      makeTextField('k', 'Unique With Default', { unique: true, defaultValue: 'unique-value' }),
      makeNumberField('l', 'Required Zero', { defaultValue: 0, required: true }),
      makeCheckboxField('m', 'Required False', { defaultValue: false, required: true }),
      makeTextField('n', 'Optional'),
    ];

    const batchSource = configure(buildTable(fixture));
    const sequentialSource = configure(buildTable(fixture));

    const batch = batchSource
      .update((mutator) => mutator.addFields(buildFields()))
      ._unsafeUnwrap().table;
    const sequential = addSequentially(sequentialSource, buildFields());

    expect(viewMetadata(batch)).toEqual(viewMetadata(sequential));

    const formMetadata = columnMetaOf(batch, 1);
    expect(
      ['h', 'i', 'j', 'k', 'l', 'm', 'n'].map((seed) => formMetadata[fieldId(seed).toString()])
    ).toEqual([
      { order: 2, visible: true },
      { order: 3, visible: true },
      { order: 4, visible: false },
      { order: 5, visible: true },
      { order: 6, visible: false },
      { order: 7, visible: false },
      { order: 8, visible: false },
    ]);
    expect(columnMetaOf(batch, 0)).toMatchObject({
      [fieldId('j').toString()]: { order: 4 },
      [fieldId('n').toString()]: { order: 8 },
    });
  });

  it('reports batch duplicate conflicts in the sequential precedence order', () => {
    const fixture = {
      fields: [
        { id: 'a', name: 'Title', primary: true },
        { id: 'b', name: 'Notes' },
      ],
      views: [{ id: 'a', name: 'Grid', type: 'grid' as const }],
    };
    const table = buildTable(fixture);
    const withDbFieldName = (seed: string, name: string, dbFieldName: string): Field => {
      const field = makeTextField(seed, name);
      field.setDbFieldName(DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap())._unsafeUnwrap();
      return field;
    };

    const duplicateId = table.update((mutator) =>
      mutator.addFields([makeTextField('h', 'Alpha'), makeTextField('h', 'Beta')])
    );
    expect(duplicateId._unsafeUnwrapErr().message).toBe('Field already exists');

    const duplicateName = table.update((mutator) =>
      mutator.addFields([makeTextField('h', 'Alpha'), makeTextField('i', 'Alpha')])
    );
    expect(duplicateName._unsafeUnwrapErr().message).toBe('Field names must be unique');

    const duplicateDbFieldName = table.update((mutator) =>
      mutator.addFields([
        withDbFieldName('h', 'Alpha', 'fld_shared_physical'),
        withDbFieldName('i', 'Beta', 'fld_shared_physical'),
      ])
    );
    const dbNameError = duplicateDbFieldName._unsafeUnwrapErr();
    expect(dbNameError.message).toBe(
      'Db Field name fld_shared_physical already exists in this table'
    );
    expect(dbNameError.localization).toEqual({
      i18nKey: 'httpErrors.field.dbFieldNameAlreadyExists',
      context: { dbFieldName: 'fld_shared_physical' },
    });

    // ID wins over name, name wins over physical name.
    const idBeforeName = table.update((mutator) =>
      mutator.addFields([makeTextField('h', 'Alpha'), makeTextField('h', 'Alpha')])
    );
    expect(idBeforeName._unsafeUnwrapErr().message).toBe('Field already exists');

    const nameBeforeDbName = table.update((mutator) =>
      mutator.addFields([
        withDbFieldName('h', 'Alpha', 'fld_shared_physical'),
        withDbFieldName('i', 'Alpha', 'fld_shared_physical'),
      ])
    );
    expect(nameBeforeDbName._unsafeUnwrapErr().message).toBe('Field names must be unique');
  });

  it('leaves the source table untouched when a batch field is rejected', () => {
    const fixture = {
      fields: [
        { id: 'a', name: 'Title', primary: true },
        { id: 'b', name: 'Notes' },
      ],
      views: [{ id: 'a', name: 'Grid', type: 'grid' as const }],
    };
    const table = patchViewColumnMeta(buildTable(fixture), viewId('a'), fieldId('b'), {
      hidden: true,
    });
    const originalMetadata = viewMetadata(table);
    const originalFieldIds = fieldIdsOf(table);

    const result = table.update((mutator) =>
      mutator.addFields([makeTextField('h', 'Alpha'), makeTextField('i', 'Notes')])
    );

    expect(result.isErr()).toBe(true);
    expect(viewMetadata(table)).toEqual(originalMetadata);
    expect(fieldIdsOf(table)).toEqual(originalFieldIds);
  });

  it('resolves same-batch formula dependencies and keeps the sequential error for forward references', () => {
    const fixture = {
      fields: [
        { id: 'a', name: 'Title', primary: true },
        { id: 'b', name: 'Amount', type: 'number' as const },
      ],
      views: [{ id: 'a', name: 'Grid', type: 'grid' as const }],
    };
    const scoreId = fieldId('c').toString();
    const formulaId = fieldId('d').toString();
    const buildFields = (): ReadonlyArray<Field> => [
      makeNumberField('c', 'Score'),
      makeFormulaField('d', 'Score Plus', `{${scoreId}} + 1`),
    ];

    const batchSource = buildTable(fixture);
    const sequentialSource = buildTable(fixture);

    const batch = batchSource
      .update((mutator) => mutator.addFields(buildFields()))
      ._unsafeUnwrap().table;
    const sequential = addSequentially(sequentialSource, buildFields());
    expect(viewMetadata(batch)).toEqual(viewMetadata(sequential));

    const formulaField = batch
      .getField((candidate) => candidate.id().equals(fieldId('d')))
      ._unsafeUnwrap();
    const scoreField = batch
      .getField((candidate) => candidate.id().equals(fieldId('c')))
      ._unsafeUnwrap();
    expect(formulaField.dependencies().map((id) => id.toString())).toEqual([scoreId]);
    expect(scoreField.dependents().map((id) => id.toString())).toEqual([formulaId]);

    const missingId = fieldId('f').toString();
    const forwardBatch = batchSource.update((mutator) =>
      mutator.addFields([
        makeFormulaField('e', 'Forward', `{${missingId}} + 1`),
        makeTextField('g', 'Title'),
      ])
    );
    const forwardSingle = sequentialSource.update((mutator) =>
      mutator.addField(makeFormulaField('e', 'Forward', `{${missingId}} + 1`))
    );

    expect(forwardBatch.isErr()).toBe(true);
    expect(forwardSingle.isErr()).toBe(true);
    expect(forwardBatch._unsafeUnwrapErr().message).toBe(forwardSingle._unsafeUnwrapErr().message);
    expect(forwardBatch._unsafeUnwrapErr().message).toContain('Formula field references not found');
  });

  it('revalidates legacy metadata restored after a rejected formula candidate', () => {
    const title = SingleLineTextField.create({
      id: fieldId('a'),
      name: fieldName('Title'),
    })._unsafeUnwrap();
    const legacy = GridView.create({
      id: viewId('z'),
      name: ViewName.create('Legacy grid')._unsafeUnwrap(),
    })._unsafeUnwrap();
    legacy
      .setColumnMeta(
        ViewColumnMeta.rehydrate({
          [fieldId('a').toString()]: { order: 0 },
          [fieldId('e').toString()]: { order: 1, width: Number.POSITIVE_INFINITY },
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    legacy.setQueryDefaults(ViewQueryDefaults.empty())._unsafeUnwrap();
    const table = Table.rehydrate({
      id: TableId.create(`tbl${'z'.repeat(16)}`)._unsafeUnwrap(),
      baseId: BASE_ID,
      name: TableName.create('Legacy batch')._unsafeUnwrap(),
      fields: [title],
      views: [legacy],
      primaryFieldId: fieldId('a'),
    })._unsafeUnwrap();
    const appender = table.createFieldAppender();
    const rejected = appender.append(
      makeFormulaField('e', 'Deferred', `{${fieldId('z').toString()}}`)
    );
    expect(rejected._unsafeUnwrapErr().message).toContain('Formula field references not found');
    const next = appender.append(makeTextField('f', 'Next'));
    expect(next._unsafeUnwrapErr().message).toBe('Invalid ViewColumnMeta');
    expect(fieldIdsOf(table)).toEqual([fieldId('a').toString()]);
    expect(columnMetaOf(table, 0)[fieldId('e').toString()]?.width).toBe(Number.POSITIVE_INFINITY);
  });

  it('builds batch view metadata with work proportional to the batch, not fields times added fields', () => {
    const fixture = {
      fields: [
        { id: 'a', name: 'Title', primary: true },
        { id: 'b', name: 'Notes' },
      ],
      views: [
        { id: 'a', name: 'Grid', type: 'grid' as const },
        { id: 'b', name: 'Form', type: 'form' as const },
        { id: 'c', name: 'Gallery', type: 'gallery' as const },
      ],
    };
    const baseFieldCount = fixture.fields.length;
    const viewTypeCount = new Set(fixture.views.map((view) => view.type)).size;
    // Work, not call count: a per-field default lookup over one field is cheap and allowed,
    // a per-field lookup over the whole table is not.
    const countFieldVisits = (run: () => void): number => {
      const spy = vi.spyOn(ViewColumnMeta, 'forView');
      try {
        run();
        return spy.mock.calls.reduce((total, [params]) => total + params.fields.length, 0);
      } finally {
        spy.mockRestore();
      }
    };
    // A bulk build visits fields + added fields once per view type per pass (preview, replay).
    // Repeated single additions visit fields + 1, fields + 2, ... for every added field.
    const budget = (addedCount: number) => 2 * viewTypeCount * (baseFieldCount + addedCount);

    const narrowSource = buildTable(fixture);
    const wideSource = buildTable(fixture);
    const narrowFields = [makeTextField('h', 'Alpha'), makeTextField('i', 'Beta')];
    const wideFields = [
      makeTextField('h', 'Alpha'),
      makeTextField('i', 'Beta'),
      makeTextField('j', 'Gamma'),
      makeTextField('k', 'Delta'),
      makeTextField('l', 'Epsilon'),
      makeTextField('m', 'Zeta'),
    ];

    const narrowVisits = countFieldVisits(() => {
      narrowSource.update((mutator) => mutator.addFields(narrowFields))._unsafeUnwrap();
    });
    const wideVisits = countFieldVisits(() => {
      wideSource.update((mutator) => mutator.addFields(wideFields))._unsafeUnwrap();
    });

    expect(narrowVisits).toBeLessThanOrEqual(budget(narrowFields.length));
    expect(wideVisits).toBeLessThanOrEqual(budget(wideFields.length));
  });
});
