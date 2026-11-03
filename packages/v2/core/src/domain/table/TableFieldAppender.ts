import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../shared/DomainError';
import { domainError } from '../shared/DomainError';
import type { Field } from './fields/Field';
import { FieldType } from './fields/FieldType';
import { validateForeignTablesForFields } from './fields/ForeignTableRelatedField';
import { FieldDefaultValueVisitor } from './fields/visitors/FieldDefaultValueVisitor';
import { resolveFormulaFields } from './resolveFormulaFields';
import type { Table } from './Table';
import type { View } from './views/View';
import {
  ViewColumnMeta,
  type ViewColumnMetaEntry,
  type ViewColumnMetaValue,
} from './views/ViewColumnMeta';
import type { ViewId } from './views/ViewId';
import { CloneViewVisitor } from './views/visitors/CloneViewVisitor';

export type TableFieldAppendOptions = {
  readonly foreignTables?: ReadonlyArray<Table>;
  readonly targetViewId?: ViewId;
};

type RehydrateTable = (
  fields: ReadonlyArray<Field>,
  views: ReadonlyArray<View>
) => Result<Table, DomainError>;

type FieldIndexes = {
  readonly ids: Set<string>;
  readonly names: Set<string>;
  readonly dbNames: Set<string>;
};

type ViewAppendState = {
  readonly view: View;
  meta?: ViewColumnMetaValue;
  maxOrder: number;
  hiddenCount: number;
  invisibleCount: number;
  validated: boolean;
  clone?: View;
  queryDefaultsSet: boolean;
};

type ViewAppendJournal = {
  readonly state: ViewAppendState;
  readonly previousEntries: ReadonlyMap<
    string,
    { readonly present: boolean; readonly entry?: ViewColumnMetaEntry }
  >;
  readonly previousMaxOrder: number;
  readonly previousValidated: boolean;
  readonly previousHiddenCount: number;
  readonly previousInvisibleCount: number;
};

/**
 * Operation-local field append context.
 *
 * `append` returns a field-resolution Table that deliberately reuses the original Views. That Table
 * must not be persisted or exposed as the operation result: only `finish` constructs final Views.
 */
export class TableFieldAppender {
  private readonly initialFields: ReadonlyArray<Field>;
  private fieldIndexes?: FieldIndexes;
  private readonly viewStates: ReadonlyArray<ViewAppendState>;
  private readonly defaultInitialMetaByViewType = new Map<string, ViewColumnMetaValue>();
  private currentTable: Table;
  private hasAppended = false;
  private finished = false;

  constructor(
    table: Table,
    private readonly options: TableFieldAppendOptions,
    private readonly rehydrateTable: RehydrateTable
  ) {
    this.currentTable = table;
    this.initialFields = table.getFields();
    this.viewStates = table.views().map((view) => ({
      view,
      maxOrder: -1,
      hiddenCount: 0,
      invisibleCount: 0,
      validated: false,
      queryDefaultsSet: false,
    }));
  }

  /**
   * Appends one accepted-prefix candidate without constructing final Views.
   * Failed candidates leave metadata and duplicate indexes unchanged.
   */
  append(field: Field): Result<Table, DomainError> {
    if (this.finished) {
      return err(domainError.invariant({ message: 'TableFieldAppender already finished' }));
    }

    const dbFieldNameResult = this.validateDuplicateField(field);
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);

    if (this.options.foreignTables?.length) {
      const validationResult = validateForeignTablesForFields([field], {
        hostTable: this.currentTable,
        foreignTables: this.options.foreignTables,
      });
      if (validationResult.isErr()) return err(validationResult.error);
    }

    const requiresFormInputResult = this.requiresFormInput(field);
    if (requiresFormInputResult.isErr()) return err(requiresFormInputResult.error);

    const candidateDefaultMetaByViewType = new Map<string, ViewColumnMetaEntry>();
    const journals: ViewAppendJournal[] = [];
    for (const state of this.viewStates) {
      const stageResult = this.stageView(
        state,
        field,
        requiresFormInputResult.value,
        candidateDefaultMetaByViewType
      );
      if (stageResult.isErr()) {
        this.rollbackViews(journals);
        return err(stageResult.error);
      }
      journals.push(stageResult.value);
    }

    const nextFields = [...this.currentTable.getFields(), field];
    const nextTableResult = this.rehydrateTable(nextFields, this.currentTable.views());
    if (nextTableResult.isErr()) {
      this.rollbackViews(journals);
      return err(nextTableResult.error);
    }

    const nextTable = nextTableResult.value;
    if (field.type().equals(FieldType.formula())) {
      const resolved = resolveFormulaFields(nextTable, {
        ignoreMissingReferenceOnExisting: true,
        strictFieldId: field.id(),
      });
      if (resolved.isErr()) {
        this.rollbackViews(journals);
        return err(resolved.error);
      }
    }

    this.fieldIndexes?.ids.add(field.id().toString());
    this.fieldIndexes?.names.add(field.name().toString());
    if (dbFieldNameResult.value !== undefined) {
      this.fieldIndexes?.dbNames.add(dbFieldNameResult.value);
    }
    this.currentTable = nextTable;
    this.hasAppended = true;
    return ok(nextTable);
  }

  /** Constructs the persistable Table and each final View exactly once. */
  finish(): Result<Table, DomainError> {
    if (this.finished) {
      return err(domainError.invariant({ message: 'TableFieldAppender already finished' }));
    }
    this.finished = true;
    if (!this.hasAppended) return ok(this.currentTable);

    const views: View[] = [];
    for (const state of this.viewStates) {
      if (!state.meta || !state.clone || !state.queryDefaultsSet) {
        return err(domainError.invariant({ message: 'TableFieldAppender View not staged' }));
      }
      const metaResult = ViewColumnMeta.create(state.meta);
      if (metaResult.isErr()) return err(metaResult.error);
      const setResult = state.clone.setColumnMeta(metaResult.value);
      if (setResult.isErr()) return err(setResult.error);
      views.push(state.clone);
    }
    return this.rehydrateTable(this.currentTable.getFields(), views);
  }

  private validateDuplicateField(field: Field): Result<string | undefined, DomainError> {
    // A singleton never amortizes indexes, especially probing unset DB names. Build them only
    // after an accepted prefix makes a second candidate worth indexing.
    if (this.hasAppended && !this.fieldIndexes) {
      const fields = this.currentTable.getFields();
      this.fieldIndexes = {
        ids: new Set(fields.map((existing) => existing.id().toString())),
        names: new Set(fields.map((existing) => existing.name().toString())),
        dbNames: new Set(),
      };
      for (const existing of fields) {
        const value = existing.dbFieldName().andThen((name) => name.value());
        if (value.isOk()) this.fieldIndexes.dbNames.add(value.value);
      }
    }

    const indexes = this.fieldIndexes;
    const duplicateId = indexes
      ? indexes.ids.has(field.id().toString())
      : this.initialFields.some((existing) => existing.id().equals(field.id()));
    if (duplicateId) {
      return err(domainError.conflict({ message: 'Field already exists' }));
    }
    const duplicateName = indexes
      ? indexes.names.has(field.name().toString())
      : this.initialFields.some((existing) => existing.name().equals(field.name()));
    if (duplicateName) {
      return err(domainError.conflict({ message: 'Field names must be unique' }));
    }

    const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
    if (dbFieldNameResult.isErr()) return ok(undefined);
    const duplicateDbName = indexes
      ? indexes.dbNames.has(dbFieldNameResult.value)
      : this.initialFields.some((existing) => {
          const value = existing.dbFieldName().andThen((name) => name.value());
          return value.isOk() && value.value === dbFieldNameResult.value;
        });
    if (!duplicateDbName) return ok(dbFieldNameResult.value);

    return err(
      domainError.conflict({
        message: `Db Field name ${dbFieldNameResult.value} already exists in this table`,
        localization: {
          i18nKey: 'httpErrors.field.dbFieldNameAlreadyExists',
          context: { dbFieldName: dbFieldNameResult.value },
        },
      })
    );
  }

  private requiresFormInput(field: Field): Result<boolean, DomainError> {
    if (!field.notNull().toBoolean() && !field.unique().toBoolean()) return ok(false);

    return field.accept(FieldDefaultValueVisitor.create()).map((defaultValue) => {
      const hasDefaultValue =
        defaultValue !== undefined &&
        defaultValue !== '' &&
        (!Array.isArray(defaultValue) || defaultValue.length > 0);
      return (
        (field.notNull().toBoolean() && !hasDefaultValue) ||
        (field.unique().toBoolean() && hasDefaultValue)
      );
    });
  }

  private stageView(
    state: ViewAppendState,
    field: Field,
    requiresFormInput: boolean,
    candidateDefaultMetaByViewType: Map<string, ViewColumnMetaEntry>
  ): Result<ViewAppendJournal, DomainError> {
    const currentMetaResult = this.ensureCurrentMeta(state);
    if (currentMetaResult.isErr()) return err(currentMetaResult.error);
    const meta = currentMetaResult.value;

    const viewType = state.view.type().toString();
    const initialDefaultsResult = this.initialDefaults(state.view);
    if (initialDefaultsResult.isErr()) return err(initialDefaultsResult.error);

    let defaultEntry = candidateDefaultMetaByViewType.get(viewType);
    if (!defaultEntry) {
      const candidateDefaultsResult = ViewColumnMeta.forView({
        viewType: state.view.type(),
        fields: [field],
        primaryFieldId: this.currentTable.primaryFieldId(),
      });
      if (candidateDefaultsResult.isErr()) return err(candidateDefaultsResult.error);
      defaultEntry = candidateDefaultsResult.value.toDto()[field.id().toString()];
      if (!defaultEntry) {
        return err(domainError.validation({ message: 'Missing new field column meta' }));
      }
      candidateDefaultMetaByViewType.set(viewType, defaultEntry);
    }

    const previousEntries = new Map<
      string,
      { readonly present: boolean; readonly entry?: ViewColumnMetaEntry }
    >();
    const journal: ViewAppendJournal = {
      state,
      previousEntries,
      previousMaxOrder: state.maxOrder,
      previousValidated: state.validated,
      previousHiddenCount: state.hiddenCount,
      previousInvisibleCount: state.invisibleCount,
    };
    const hadHiddenField = state.hiddenCount > 0;
    const hadInvisibleField = state.invisibleCount > 0;

    for (const existingField of this.currentTable.getFields()) {
      const key = existingField.id().toString();
      if (typeof meta[key]?.order === 'number') continue;
      const defaultExistingEntry = initialDefaultsResult.value[key];
      if (!defaultExistingEntry) {
        this.rollbackView(journal);
        return err(domainError.validation({ message: 'Missing existing field column meta' }));
      }
      state.maxOrder += 1;
      this.replaceEntry(state, previousEntries, key, {
        ...defaultExistingEntry,
        ...meta[key],
        order: state.maxOrder,
      });
    }

    const nextEntry = this.buildAddedFieldColumnMetaEntry({
      state,
      defaultEntry,
      requiresFormInput,
      hadHiddenField,
      hadInvisibleField,
    });
    state.maxOrder += 1;
    this.replaceEntry(state, previousEntries, field.id().toString(), {
      ...nextEntry,
      order: state.maxOrder,
    });

    const validationInput = state.validated
      ? Object.fromEntries([...previousEntries.keys()].map((key) => [key, meta[key]!]))
      : meta;
    const validationResult = ViewColumnMeta.create(validationInput);
    if (validationResult.isErr()) {
      this.rollbackView(journal);
      return err(validationResult.error);
    }
    state.validated = true;

    const cloneResult = state.clone ? ok(state.clone) : state.view.accept(new CloneViewVisitor());
    if (cloneResult.isErr()) {
      this.rollbackView(journal);
      return err(cloneResult.error);
    }
    state.clone = cloneResult.value;

    if (!state.queryDefaultsSet) {
      const queryDefaultsResult = state.view.queryDefaults();
      if (queryDefaultsResult.isErr()) {
        this.rollbackView(journal);
        return err(queryDefaultsResult.error);
      }
      const setQueryResult = state.clone.setQueryDefaults(queryDefaultsResult.value);
      if (setQueryResult.isErr()) {
        this.rollbackView(journal);
        return err(setQueryResult.error);
      }
      state.queryDefaultsSet = true;
    }

    return ok(journal);
  }

  private ensureCurrentMeta(state: ViewAppendState): Result<ViewColumnMetaValue, DomainError> {
    if (state.meta) return ok(state.meta);
    const currentMetaResult = state.view.columnMeta();
    if (currentMetaResult.isErr()) return err(currentMetaResult.error);

    const meta = currentMetaResult.value.toDto();
    state.meta = meta;
    const entries = Object.values(meta);
    state.maxOrder = entries.length ? Math.max(...entries.map((entry) => entry.order ?? -1)) : -1;
    state.hiddenCount = entries.filter((entry) => entry.hidden === true).length;
    state.invisibleCount = entries.filter((entry) => entry.visible === false).length;
    return ok(meta);
  }

  private initialDefaults(view: View): Result<ViewColumnMetaValue, DomainError> {
    const viewType = view.type().toString();
    const cached = this.defaultInitialMetaByViewType.get(viewType);
    if (cached) return ok(cached);

    return ViewColumnMeta.forView({
      viewType: view.type(),
      fields: this.initialFields,
      primaryFieldId: this.currentTable.primaryFieldId(),
    }).map((meta) => {
      const dto = meta.toDto();
      this.defaultInitialMetaByViewType.set(viewType, dto);
      return dto;
    });
  }

  private buildAddedFieldColumnMetaEntry(params: {
    state: ViewAppendState;
    defaultEntry: ViewColumnMetaEntry;
    requiresFormInput: boolean;
    hadHiddenField: boolean;
    hadInvisibleField: boolean;
  }): ViewColumnMetaEntry {
    const { state, defaultEntry, requiresFormInput, hadHiddenField, hadInvisibleField } = params;
    if (this.options.targetViewId?.equals(state.view.id())) return { ...defaultEntry };
    if (state.view.type().toString() === 'form' && requiresFormInput) {
      return { ...defaultEntry };
    }
    if (state.view.type().toString() === 'grid') {
      return hadHiddenField ? { ...defaultEntry, hidden: true } : { ...defaultEntry };
    }
    return hadInvisibleField ? { ...defaultEntry, visible: false } : { ...defaultEntry };
  }

  private replaceEntry(
    state: ViewAppendState,
    previousEntries: Map<
      string,
      { readonly present: boolean; readonly entry?: ViewColumnMetaEntry }
    >,
    key: string,
    entry: ViewColumnMetaEntry
  ): void {
    const meta = state.meta!;
    const previous = meta[key];
    if (!previousEntries.has(key)) {
      previousEntries.set(key, { present: Object.hasOwn(meta, key), entry: previous });
    }
    if (previous?.hidden === true) state.hiddenCount -= 1;
    if (previous?.visible === false) state.invisibleCount -= 1;
    meta[key] = entry;
    if (entry.hidden === true) state.hiddenCount += 1;
    if (entry.visible === false) state.invisibleCount += 1;
  }

  private rollbackViews(journals: ReadonlyArray<ViewAppendJournal>): void {
    for (let index = journals.length - 1; index >= 0; index -= 1) {
      this.rollbackView(journals[index]!);
    }
  }

  private rollbackView(journal: ViewAppendJournal): void {
    const { state } = journal;
    const meta = state.meta!;
    for (const [key, previous] of journal.previousEntries) {
      if (previous.present) meta[key] = previous.entry!;
      else delete meta[key];
    }
    state.maxOrder = journal.previousMaxOrder;
    state.validated = journal.previousValidated;
    state.hiddenCount = journal.previousHiddenCount;
    state.invisibleCount = journal.previousInvisibleCount;
  }
}
