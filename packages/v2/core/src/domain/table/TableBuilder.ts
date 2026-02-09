import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../base/BaseId';
import { domainError, type DomainError } from '../shared/DomainError';
import { DbTableName } from './DbTableName';
import type { Field } from './fields/Field';
import { createNewLinkField } from './fields/FieldFactory';
import { FieldId } from './fields/FieldId';
import type { FieldName } from './fields/FieldName';
import { validateForeignTablesForFields } from './fields/ForeignTableRelatedField';
import { AttachmentField } from './fields/types/AttachmentField';
import { AutoNumberField } from './fields/types/AutoNumberField';
import { ButtonField } from './fields/types/ButtonField';
import { ButtonLabel } from './fields/types/ButtonLabel';
import type { ButtonMaxCount } from './fields/types/ButtonMaxCount';
import type { ButtonResetCount } from './fields/types/ButtonResetCount';
import type { ButtonWorkflow } from './fields/types/ButtonWorkflow';
import type { CellValueMultiplicity } from './fields/types/CellValueMultiplicity';
import type { CellValueType } from './fields/types/CellValueType';
import type { CheckboxDefaultValue } from './fields/types/CheckboxDefaultValue';
import { CheckboxField } from './fields/types/CheckboxField';
import { ConditionalLookupField } from './fields/types/ConditionalLookupField';
import type { ConditionalLookupOptions } from './fields/types/ConditionalLookupOptions';
import type { ConditionalRollupConfig } from './fields/types/ConditionalRollupConfig';
import {
  ConditionalRollupField,
  type ConditionalRollupFormatting,
  type ConditionalRollupShowAs,
} from './fields/types/ConditionalRollupField';
import { CreatedByField } from './fields/types/CreatedByField';
import { CreatedTimeField } from './fields/types/CreatedTimeField';
import type { DateDefaultValue } from './fields/types/DateDefaultValue';
import { DateField } from './fields/types/DateField';
import { DateTimeFormatting } from './fields/types/DateTimeFormatting';
import { FieldColor } from './fields/types/FieldColor';
import { FieldNotNull } from './fields/types/FieldNotNull';
import { FieldUnique } from './fields/types/FieldUnique';
import type { FormulaExpression } from './fields/types/FormulaExpression';
import {
  FormulaField,
  type FormulaFormatting,
  type FormulaShowAs,
} from './fields/types/FormulaField';
import { LastModifiedByField } from './fields/types/LastModifiedByField';
import { LastModifiedTimeField } from './fields/types/LastModifiedTimeField';
import type { LinkFieldConfig } from './fields/types/LinkFieldConfig';
import type { LinkFieldMeta } from './fields/types/LinkFieldMeta';
import { LongTextField } from './fields/types/LongTextField';
import { LookupField } from './fields/types/LookupField';
import type { LookupOptions } from './fields/types/LookupOptions';
import { MultipleSelectField } from './fields/types/MultipleSelectField';
import type { NumberDefaultValue } from './fields/types/NumberDefaultValue';
import { NumberField } from './fields/types/NumberField';
import { NumberFormatting } from './fields/types/NumberFormatting';
import type { NumberShowAs } from './fields/types/NumberShowAs';
import { RatingColor } from './fields/types/RatingColor';
import { RatingField } from './fields/types/RatingField';
import { RatingIcon } from './fields/types/RatingIcon';
import { RatingMax } from './fields/types/RatingMax';
import type { RollupExpression } from './fields/types/RollupExpression';
import { RollupField, type RollupFormatting, type RollupShowAs } from './fields/types/RollupField';
import type { RollupFieldConfig } from './fields/types/RollupFieldConfig';
import { SelectAutoNewOptions } from './fields/types/SelectAutoNewOptions';
import type { SelectDefaultValue } from './fields/types/SelectDefaultValue';
import type { SelectOption } from './fields/types/SelectOption';
import { SingleLineTextField } from './fields/types/SingleLineTextField';
import type { SingleLineTextShowAs } from './fields/types/SingleLineTextShowAs';
import { SingleSelectField } from './fields/types/SingleSelectField';
import type { TextDefaultValue } from './fields/types/TextDefaultValue';
import type { TimeZone } from './fields/types/TimeZone';
import type { UserDefaultValue } from './fields/types/UserDefaultValue';
import { UserField } from './fields/types/UserField';
import { UserMultiplicity } from './fields/types/UserMultiplicity';
import { UserNotification } from './fields/types/UserNotification';
import { resolveFormulaFields } from './resolveFormulaFields';
import type { Table } from './Table';
import { TableId } from './TableId';
import type { TableName } from './TableName';
import { CalendarView } from './views/types/CalendarView';
import { FormView } from './views/types/FormView';
import { GalleryView } from './views/types/GalleryView';
import { GridView } from './views/types/GridView';
import { KanbanView } from './views/types/KanbanView';
import { PluginView } from './views/types/PluginView';
import type { View } from './views/View';
import { ViewColumnMeta } from './views/ViewColumnMeta';
import { ViewId } from './views/ViewId';
import { ViewName } from './views/ViewName';
import { ViewQueryDefaults } from './views/ViewQueryDefaults';

export interface ITableBuildProps {
  id: TableId;
  baseId: BaseId;
  name: TableName;
  fields: ReadonlyArray<Field>;
  views: ReadonlyArray<View>;
  primaryFieldId: FieldId;
  dbTableName?: DbTableName;
}

export type TableBuildOptions = {
  foreignTables?: ReadonlyArray<Table>;
  includeSelf?: boolean;
};

export type ITableFactory = (props: ITableBuildProps) => Table;

export interface ITableBuilderSink {
  addError(error: DomainError | string): void;
  addFieldResult(result: Result<Field, DomainError>): void;
  addViewResult(result: Result<View, DomainError>): void;
}

const fieldNameRequiredError = 'FieldName is required';
const viewNameRequiredError = 'ViewName is required';
const formulaExpressionRequiredError = 'Formula expression is required';
const linkConfigRequiredError = 'LinkFieldConfig is required';
const rollupExpressionRequiredError = 'Rollup expression is required';
const rollupConfigRequiredError = 'RollupFieldConfig is required';
const lookupOptionsRequiredError = 'LookupOptions is required';
const lookupInnerFieldRequiredError = 'Lookup inner field is required';
const conditionalRollupConfigRequiredError = 'ConditionalRollupConfig is required';
const conditionalRollupExpressionRequiredError = 'Conditional rollup expression is required';
const conditionalLookupOptionsRequiredError = 'ConditionalLookupOptions is required';

const isUniqueByStringValue = (values: ReadonlyArray<{ toString(): string }>): boolean => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toString();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};

const resolveFieldId = (id?: FieldId): Result<FieldId, DomainError> =>
  id ? ok(id) : FieldId.generate();

const applyFieldValidation = (
  field: Field,
  notNull: FieldNotNull,
  unique: FieldUnique
): Result<Field, DomainError> =>
  field
    .setNotNull(notNull)
    .andThen(() => field.setUnique(unique))
    .map(() => field);

export class TableBuilder {
  private tableId: TableId | undefined;
  private baseId: BaseId | undefined;
  private tableName: TableName | undefined;
  private readonly fields: Field[] = [];
  private readonly views: View[] = [];
  private readonly errors: DomainError[] = [];
  private primaryFieldId: FieldId | undefined;

  private constructor(private readonly factory: ITableFactory) {}

  static create(factory: ITableFactory): TableBuilder {
    return new TableBuilder(factory);
  }

  withId(id: TableId): TableBuilder {
    this.tableId = id;
    return this;
  }

  withBaseId(baseId: BaseId): TableBuilder {
    this.baseId = baseId;
    return this;
  }

  withName(name: TableName): TableBuilder {
    this.tableName = name;
    return this;
  }

  field(): TableFieldBuilder {
    return new TableFieldBuilder(this, this.sink());
  }

  view(): TableViewBuilder {
    return new TableViewBuilder(this, this.sink());
  }

  build(options?: TableBuildOptions): Result<Table, DomainError> {
    const tableName = this.tableName;
    if (!tableName) return err(domainError.validation({ message: 'TableName is required' }));
    const baseId = this.baseId;
    if (!baseId) return err(domainError.validation({ message: 'BaseId is required' }));

    if (this.errors.length > 0) {
      if (this.errors.length === 1) return err(this.errors[0]);
      return err(
        domainError.validation({
          code: 'table.builder',
          message: 'Table builder errors',
          details: { errors: this.errors.map((error) => error.message) },
        })
      );
    }

    if (this.fields.length === 0)
      return err(domainError.unexpected({ message: 'Table requires at least one Field' }));
    if (this.views.length === 0)
      return err(domainError.unexpected({ message: 'Table requires at least one View' }));
    if (!isUniqueByStringValue(this.views.map((v) => v.name())))
      return err(domainError.conflict({ message: 'View names must be unique' }));

    if (!isUniqueByStringValue(this.fields.map((f) => f.name())))
      return err(domainError.conflict({ message: 'Field names must be unique' }));

    const primaryFieldId = this.primaryFieldId ?? this.fields[0]?.id();
    if (!primaryFieldId)
      return err(domainError.unexpected({ message: 'Table requires a primary Field' }));
    if (!this.fields.some((f) => f.id().equals(primaryFieldId)))
      return err(domainError.validation({ message: 'Primary Field must exist in Table fields' }));

    const columnMetaResult = this.applyViewColumnMeta(this.views, this.fields, primaryFieldId);
    if (columnMetaResult.isErr()) return err(columnMetaResult.error);

    const viewDefaultsResult = this.applyViewQueryDefaults(this.views);
    if (viewDefaultsResult.isErr()) return err(viewDefaultsResult.error);

    const idResult = this.ensureTableId();

    return idResult.andThen((id) =>
      DbTableName.rehydrate(`${baseId.toString()}.${id.toString()}`).andThen((dbTableName) => {
        const table = this.factory({
          id,
          baseId,
          name: tableName,
          fields: [...this.fields],
          views: [...this.views],
          primaryFieldId,
        });
        const setDbNameResult = table.setDbTableName(dbTableName);
        if (setDbNameResult.isErr()) return err(setDbNameResult.error);
        const validationResult = this.validateForeignTables(table, options);
        if (validationResult.isErr()) return err(validationResult.error);
        const resolveResult = resolveFormulaFields(table);
        if (resolveResult.isErr()) return err(resolveResult.error);
        return ok(table);
      })
    );
  }

  ensureTableId(): Result<TableId, DomainError> {
    if (this.tableId) return ok(this.tableId);
    return TableId.generate().map((id) => {
      this.tableId = id;
      return id;
    });
  }

  requireBaseId(): Result<BaseId, DomainError> {
    if (!this.baseId) return err(domainError.validation({ message: 'BaseId is required' }));
    return ok(this.baseId);
  }

  private sink(): ITableBuilderSink {
    return {
      addError: (message) => this.addError(message),
      addFieldResult: (result) => this.addFieldResult(result),
      addViewResult: (result) => this.addViewResult(result),
    };
  }

  private addError(error: DomainError | string): void {
    this.errors.push(
      typeof error === 'string' ? domainError.unexpected({ message: error }) : error
    );
  }

  private addField(field: Field): void {
    this.fields.push(field);
  }

  private addView(view: View): void {
    this.views.push(view);
  }

  private addFieldResult(result: Result<Field, DomainError>): void {
    result.match(
      (field) => this.addField(field),
      (e) => this.addError(e)
    );
  }

  /**
   * Add a field directly to the table builder from a Result.
   * This is useful for fields created outside the builder pattern (e.g., pending lookup fields).
   */
  addFieldFromResult(result: Result<Field, DomainError>): TableBuilder {
    this.addFieldResult(result);
    return this;
  }

  private addViewResult(result: Result<View, DomainError>): void {
    result.match(
      (view) => this.addView(view),
      (e) => this.addError(e)
    );
  }

  markPrimaryFieldId(fieldId: FieldId): Result<void, DomainError> {
    if (this.primaryFieldId)
      return err(domainError.unexpected({ message: 'Table can only have one primary Field' }));
    this.primaryFieldId = fieldId;
    return ok(undefined);
  }

  private applyViewColumnMeta(
    views: ReadonlyArray<View>,
    fields: ReadonlyArray<Field>,
    primaryFieldId: FieldId
  ): Result<void, DomainError> {
    for (const view of views) {
      const metaResult = ViewColumnMeta.forView({
        viewType: view.type(),
        fields,
        primaryFieldId,
      });
      if (metaResult.isErr()) return err(metaResult.error);
      const setResult = view.setColumnMeta(metaResult.value);
      if (setResult.isErr()) return err(setResult.error);
    }
    return ok(undefined);
  }

  private applyViewQueryDefaults(views: ReadonlyArray<View>): Result<void, DomainError> {
    for (const view of views) {
      const setResult = view.setQueryDefaults(ViewQueryDefaults.empty());
      if (setResult.isErr()) return err(setResult.error);
    }
    return ok(undefined);
  }

  private validateForeignTables(
    table: Table,
    options?: TableBuildOptions
  ): Result<void, DomainError> {
    const foreignTables = [...(options?.foreignTables ?? [])];
    if (options?.includeSelf) {
      foreignTables.push(table);
    }
    if (foreignTables.length === 0) return ok(undefined);
    return validateForeignTablesForFields(table.getFields(), {
      hostTable: table,
      foreignTables,
    });
  }
}

export class TableFieldBuilder {
  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  singleLineText(): SingleLineTextFieldBuilder {
    return new SingleLineTextFieldBuilder(this.parent, this.sink);
  }

  longText(): LongTextFieldBuilder {
    return new LongTextFieldBuilder(this.parent, this.sink);
  }

  number(): NumberFieldBuilder {
    return new NumberFieldBuilder(this.parent, this.sink);
  }

  rating(): RatingFieldBuilder {
    return new RatingFieldBuilder(this.parent, this.sink);
  }

  formula(): FormulaFieldBuilder {
    return new FormulaFieldBuilder(this.parent, this.sink);
  }

  rollup(): RollupFieldBuilder {
    return new RollupFieldBuilder(this.parent, this.sink);
  }

  lookup(): LookupFieldBuilder {
    return new LookupFieldBuilder(this.parent, this.sink);
  }

  singleSelect(): SingleSelectFieldBuilder {
    return new SingleSelectFieldBuilder(this.parent, this.sink);
  }

  multipleSelect(): MultipleSelectFieldBuilder {
    return new MultipleSelectFieldBuilder(this.parent, this.sink);
  }

  checkbox(): CheckboxFieldBuilder {
    return new CheckboxFieldBuilder(this.parent, this.sink);
  }

  attachment(): AttachmentFieldBuilder {
    return new AttachmentFieldBuilder(this.parent, this.sink);
  }

  date(): DateFieldBuilder {
    return new DateFieldBuilder(this.parent, this.sink);
  }

  createdTime(): CreatedTimeFieldBuilder {
    return new CreatedTimeFieldBuilder(this.parent, this.sink);
  }

  lastModifiedTime(): LastModifiedTimeFieldBuilder {
    return new LastModifiedTimeFieldBuilder(this.parent, this.sink);
  }

  user(): UserFieldBuilder {
    return new UserFieldBuilder(this.parent, this.sink);
  }

  createdBy(): CreatedByFieldBuilder {
    return new CreatedByFieldBuilder(this.parent, this.sink);
  }

  lastModifiedBy(): LastModifiedByFieldBuilder {
    return new LastModifiedByFieldBuilder(this.parent, this.sink);
  }

  autoNumber(): AutoNumberFieldBuilder {
    return new AutoNumberFieldBuilder(this.parent, this.sink);
  }

  button(): ButtonFieldBuilder {
    return new ButtonFieldBuilder(this.parent, this.sink);
  }

  link(): LinkFieldBuilder {
    return new LinkFieldBuilder(this.parent, this.sink);
  }

  conditionalRollup(): ConditionalRollupFieldBuilder {
    return new ConditionalRollupFieldBuilder(this.parent, this.sink);
  }

  conditionalLookup(): ConditionalLookupFieldBuilder {
    return new ConditionalLookupFieldBuilder(this.parent, this.sink);
  }
}

export class SingleLineTextFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private showAs: SingleLineTextShowAs | undefined;
  private defaultValue: TextDefaultValue | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): SingleLineTextFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): SingleLineTextFieldBuilder {
    this.id = id;
    return this;
  }

  withShowAs(showAs: SingleLineTextShowAs): SingleLineTextFieldBuilder {
    this.showAs = showAs;
    return this;
  }

  withDefaultValue(defaultValue: TextDefaultValue): SingleLineTextFieldBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withNotNull(notNull: FieldNotNull): SingleLineTextFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): SingleLineTextFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): SingleLineTextFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      SingleLineTextField.create({
        id,
        name,
        showAs: this.showAs,
        defaultValue: this.defaultValue,
      })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class LongTextFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private defaultValue: TextDefaultValue | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): LongTextFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): LongTextFieldBuilder {
    this.id = id;
    return this;
  }

  withDefaultValue(defaultValue: TextDefaultValue): LongTextFieldBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withNotNull(notNull: FieldNotNull): LongTextFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): LongTextFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): LongTextFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      LongTextField.create({ id, name, defaultValue: this.defaultValue })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class NumberFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private formatting: NumberFormatting = NumberFormatting.default();
  private showAs: NumberShowAs | undefined;
  private defaultValue: NumberDefaultValue | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): NumberFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): NumberFieldBuilder {
    this.id = id;
    return this;
  }

  withFormatting(formatting: NumberFormatting): NumberFieldBuilder {
    this.formatting = formatting;
    return this;
  }

  withShowAs(showAs: NumberShowAs): NumberFieldBuilder {
    this.showAs = showAs;
    return this;
  }

  withDefaultValue(defaultValue: NumberDefaultValue): NumberFieldBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withNotNull(notNull: FieldNotNull): NumberFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): NumberFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): NumberFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      NumberField.create({
        id,
        name,
        formatting: this.formatting,
        showAs: this.showAs,
        defaultValue: this.defaultValue,
      })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class RatingFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private max: RatingMax = RatingMax.five();
  private icon: RatingIcon = RatingIcon.star();
  private color: RatingColor = RatingColor.yellowBright();
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): RatingFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): RatingFieldBuilder {
    this.id = id;
    return this;
  }

  withMax(max: RatingMax): RatingFieldBuilder {
    this.max = max;
    return this;
  }

  withIcon(icon: RatingIcon): RatingFieldBuilder {
    this.icon = icon;
    return this;
  }

  withColor(color: RatingColor): RatingFieldBuilder {
    this.color = color;
    return this;
  }

  withNotNull(notNull: FieldNotNull): RatingFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): RatingFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): RatingFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      RatingField.create({ id, name, max: this.max, icon: this.icon, color: this.color }).andThen(
        (field) =>
          applyFieldValidation(field, this.notNull, this.unique).andThen((validated) => {
            if (!this.isPrimary) return ok(validated);
            return this.parent.markPrimaryFieldId(validated.id()).map(() => validated);
          })
      )
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class FormulaFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private expression: FormulaExpression | undefined;
  private timeZone: TimeZone | undefined;
  private formatting: FormulaFormatting | undefined;
  private showAs: FormulaShowAs | undefined;
  private dependencies: ReadonlyArray<FieldId> = [];
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): FormulaFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): FormulaFieldBuilder {
    this.id = id;
    return this;
  }

  withExpression(expression: FormulaExpression): FormulaFieldBuilder {
    this.expression = expression;
    return this;
  }

  withTimeZone(timeZone: TimeZone): FormulaFieldBuilder {
    this.timeZone = timeZone;
    return this;
  }

  withFormatting(formatting: FormulaFormatting): FormulaFieldBuilder {
    this.formatting = formatting;
    return this;
  }

  withShowAs(showAs: FormulaShowAs): FormulaFieldBuilder {
    this.showAs = showAs;
    return this;
  }

  withDependencies(dependencies: ReadonlyArray<FieldId>): FormulaFieldBuilder {
    this.dependencies = [...dependencies];
    return this;
  }

  primary(): FormulaFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }
    const expression = this.expression;
    if (!expression) {
      this.sink.addError(formulaExpressionRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      FormulaField.create({
        id,
        name,
        expression,
        timeZone: this.timeZone,
        formatting: this.formatting,
        showAs: this.showAs,
        dependencies: this.dependencies,
      }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class RollupFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private config: RollupFieldConfig | undefined;
  private expression: RollupExpression | undefined;
  private valuesField: Field | undefined;
  private timeZone: TimeZone | undefined;
  private formatting: RollupFormatting | undefined;
  private showAs: RollupShowAs | undefined;
  private resultType:
    | { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity }
    | undefined;
  private dependencies: ReadonlyArray<FieldId> = [];
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): RollupFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): RollupFieldBuilder {
    this.id = id;
    return this;
  }

  withConfig(config: RollupFieldConfig): RollupFieldBuilder {
    this.config = config;
    return this;
  }

  withExpression(expression: RollupExpression): RollupFieldBuilder {
    this.expression = expression;
    return this;
  }

  withValuesField(valuesField: Field): RollupFieldBuilder {
    this.valuesField = valuesField;
    return this;
  }

  withTimeZone(timeZone: TimeZone): RollupFieldBuilder {
    this.timeZone = timeZone;
    return this;
  }

  withFormatting(formatting: RollupFormatting): RollupFieldBuilder {
    this.formatting = formatting;
    return this;
  }

  withShowAs(showAs: RollupShowAs): RollupFieldBuilder {
    this.showAs = showAs;
    return this;
  }

  withResultType(resultType: {
    cellValueType: CellValueType;
    isMultipleCellValue: CellValueMultiplicity;
  }): RollupFieldBuilder {
    this.resultType = resultType;
    return this;
  }

  withDependencies(dependencies: ReadonlyArray<FieldId>): RollupFieldBuilder {
    this.dependencies = [...dependencies];
    return this;
  }

  primary(): RollupFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }
    const config = this.config;
    if (!config) {
      this.sink.addError(rollupConfigRequiredError);
      return this.parent;
    }
    const expression = this.expression;
    if (!expression) {
      this.sink.addError(rollupExpressionRequiredError);
      return this.parent;
    }
    const valuesField = this.valuesField;

    const result = resolveFieldId(this.id).andThen((id) =>
      (valuesField
        ? RollupField.create({
            id,
            name,
            config,
            expression,
            valuesField,
            timeZone: this.timeZone,
            formatting: this.formatting,
            showAs: this.showAs,
            dependencies: this.dependencies,
          })
        : RollupField.createPending({
            id,
            name,
            config,
            expression,
            timeZone: this.timeZone,
            formatting: this.formatting,
            showAs: this.showAs,
            resultType: this.resultType,
            dependencies: this.dependencies,
          })
      ).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class LookupFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private lookupOptions: LookupOptions | undefined;
  private innerField: Field | undefined;
  private dependencies: ReadonlyArray<FieldId> = [];
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): LookupFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): LookupFieldBuilder {
    this.id = id;
    return this;
  }

  withLookupOptions(options: LookupOptions): LookupFieldBuilder {
    this.lookupOptions = options;
    return this;
  }

  /**
   * Set the inner field that defines the lookup value type and formatting.
   * This should be a field that matches the type of the field being looked up.
   */
  withInnerField(innerField: Field): LookupFieldBuilder {
    this.innerField = innerField;
    return this;
  }

  withDependencies(dependencies: ReadonlyArray<FieldId>): LookupFieldBuilder {
    this.dependencies = [...dependencies];
    return this;
  }

  primary(): LookupFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }
    const lookupOptions = this.lookupOptions;
    if (!lookupOptions) {
      this.sink.addError(lookupOptionsRequiredError);
      return this.parent;
    }
    const innerField = this.innerField;
    if (!innerField) {
      this.sink.addError(lookupInnerFieldRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      LookupField.create({
        id,
        name,
        innerField,
        lookupOptions,
        dependencies: this.dependencies,
      }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class SingleSelectFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private options: ReadonlyArray<SelectOption> = [];
  private defaultValue: SelectDefaultValue | undefined;
  private preventAutoNewOptions: SelectAutoNewOptions = SelectAutoNewOptions.allow();
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): SingleSelectFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): SingleSelectFieldBuilder {
    this.id = id;
    return this;
  }

  withOptions(options: ReadonlyArray<SelectOption>): SingleSelectFieldBuilder {
    this.options = [...options];
    return this;
  }

  withDefaultValue(defaultValue: SelectDefaultValue): SingleSelectFieldBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withPreventAutoNewOptions(preventAutoNewOptions: SelectAutoNewOptions): SingleSelectFieldBuilder {
    this.preventAutoNewOptions = preventAutoNewOptions;
    return this;
  }

  withNotNull(notNull: FieldNotNull): SingleSelectFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): SingleSelectFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): SingleSelectFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      SingleSelectField.create({
        id,
        name,
        options: this.options,
        defaultValue: this.defaultValue,
        preventAutoNewOptions: this.preventAutoNewOptions,
      })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class MultipleSelectFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private options: ReadonlyArray<SelectOption> = [];
  private defaultValue: SelectDefaultValue | undefined;
  private preventAutoNewOptions: SelectAutoNewOptions = SelectAutoNewOptions.allow();
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): MultipleSelectFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): MultipleSelectFieldBuilder {
    this.id = id;
    return this;
  }

  withOptions(options: ReadonlyArray<SelectOption>): MultipleSelectFieldBuilder {
    this.options = [...options];
    return this;
  }

  withDefaultValue(defaultValue: SelectDefaultValue): MultipleSelectFieldBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withPreventAutoNewOptions(
    preventAutoNewOptions: SelectAutoNewOptions
  ): MultipleSelectFieldBuilder {
    this.preventAutoNewOptions = preventAutoNewOptions;
    return this;
  }

  withNotNull(notNull: FieldNotNull): MultipleSelectFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): MultipleSelectFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): MultipleSelectFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      MultipleSelectField.create({
        id,
        name,
        options: this.options,
        defaultValue: this.defaultValue,
        preventAutoNewOptions: this.preventAutoNewOptions,
      })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class CheckboxFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private defaultValue: CheckboxDefaultValue | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): CheckboxFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): CheckboxFieldBuilder {
    this.id = id;
    return this;
  }

  withDefaultValue(defaultValue: CheckboxDefaultValue): CheckboxFieldBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withNotNull(notNull: FieldNotNull): CheckboxFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): CheckboxFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): CheckboxFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      CheckboxField.create({ id, name, defaultValue: this.defaultValue })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class AttachmentFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): AttachmentFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): AttachmentFieldBuilder {
    this.id = id;
    return this;
  }

  withNotNull(notNull: FieldNotNull): AttachmentFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): AttachmentFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): AttachmentFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      AttachmentField.create({ id, name })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class DateFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private formatting: DateTimeFormatting = DateTimeFormatting.default();
  private defaultValue: DateDefaultValue | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): DateFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): DateFieldBuilder {
    this.id = id;
    return this;
  }

  withFormatting(formatting: DateTimeFormatting): DateFieldBuilder {
    this.formatting = formatting;
    return this;
  }

  withDefaultValue(defaultValue: DateDefaultValue): DateFieldBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withNotNull(notNull: FieldNotNull): DateFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): DateFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): DateFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      DateField.create({
        id,
        name,
        formatting: this.formatting,
        defaultValue: this.defaultValue,
      })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class CreatedTimeFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private formatting: DateTimeFormatting = DateTimeFormatting.default();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): CreatedTimeFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): CreatedTimeFieldBuilder {
    this.id = id;
    return this;
  }

  withFormatting(formatting: DateTimeFormatting): CreatedTimeFieldBuilder {
    this.formatting = formatting;
    return this;
  }

  primary(): CreatedTimeFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      CreatedTimeField.create({
        id,
        name,
        formatting: this.formatting,
      }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class LastModifiedTimeFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private formatting: DateTimeFormatting = DateTimeFormatting.default();
  private trackedFieldIds: ReadonlyArray<FieldId> = [];
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): LastModifiedTimeFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): LastModifiedTimeFieldBuilder {
    this.id = id;
    return this;
  }

  withFormatting(formatting: DateTimeFormatting): LastModifiedTimeFieldBuilder {
    this.formatting = formatting;
    return this;
  }

  withTrackedFieldIds(trackedFieldIds: ReadonlyArray<FieldId>): LastModifiedTimeFieldBuilder {
    this.trackedFieldIds = [...trackedFieldIds];
    return this;
  }

  primary(): LastModifiedTimeFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      LastModifiedTimeField.create({
        id,
        name,
        formatting: this.formatting,
        trackedFieldIds: this.trackedFieldIds,
      }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class UserFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private multiplicity: UserMultiplicity = UserMultiplicity.single();
  private notification: UserNotification = UserNotification.enabled();
  private defaultValue: UserDefaultValue | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): UserFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): UserFieldBuilder {
    this.id = id;
    return this;
  }

  withMultiplicity(multiplicity: UserMultiplicity): UserFieldBuilder {
    this.multiplicity = multiplicity;
    return this;
  }

  withNotification(notification: UserNotification): UserFieldBuilder {
    this.notification = notification;
    return this;
  }

  withDefaultValue(defaultValue: UserDefaultValue): UserFieldBuilder {
    this.defaultValue = defaultValue;
    return this;
  }

  withNotNull(notNull: FieldNotNull): UserFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): UserFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): UserFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      UserField.create({
        id,
        name,
        isMultiple: this.multiplicity,
        shouldNotify: this.notification,
        defaultValue: this.defaultValue,
      })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class CreatedByFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): CreatedByFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): CreatedByFieldBuilder {
    this.id = id;
    return this;
  }

  primary(): CreatedByFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      CreatedByField.create({ id, name }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class LastModifiedByFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private trackedFieldIds: ReadonlyArray<FieldId> = [];
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): LastModifiedByFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): LastModifiedByFieldBuilder {
    this.id = id;
    return this;
  }

  withTrackedFieldIds(trackedFieldIds: ReadonlyArray<FieldId>): LastModifiedByFieldBuilder {
    this.trackedFieldIds = [...trackedFieldIds];
    return this;
  }

  primary(): LastModifiedByFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      LastModifiedByField.create({ id, name, trackedFieldIds: this.trackedFieldIds }).andThen(
        (field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        }
      )
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class AutoNumberFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): AutoNumberFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): AutoNumberFieldBuilder {
    this.id = id;
    return this;
  }

  primary(): AutoNumberFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      AutoNumberField.create({ id, name }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class ButtonFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private label: ButtonLabel = ButtonLabel.default();
  private color: FieldColor = FieldColor.from('teal');
  private maxCount: ButtonMaxCount | undefined;
  private resetCount: ButtonResetCount | undefined;
  private workflow: ButtonWorkflow | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): ButtonFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): ButtonFieldBuilder {
    this.id = id;
    return this;
  }

  withLabel(label: ButtonLabel): ButtonFieldBuilder {
    this.label = label;
    return this;
  }

  withColor(color: FieldColor): ButtonFieldBuilder {
    this.color = color;
    return this;
  }

  withMaxCount(maxCount: ButtonMaxCount): ButtonFieldBuilder {
    this.maxCount = maxCount;
    return this;
  }

  withResetCount(resetCount: ButtonResetCount): ButtonFieldBuilder {
    this.resetCount = resetCount;
    return this;
  }

  withWorkflow(workflow: ButtonWorkflow): ButtonFieldBuilder {
    this.workflow = workflow;
    return this;
  }

  withNotNull(notNull: FieldNotNull): ButtonFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): ButtonFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): ButtonFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      ButtonField.create({
        id,
        name,
        label: this.label,
        color: this.color,
        maxCount: this.maxCount,
        resetCount: this.resetCount,
        workflow: this.workflow,
      })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class LinkFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private config: LinkFieldConfig | undefined;
  private meta: LinkFieldMeta | undefined;
  private notNull: FieldNotNull = FieldNotNull.optional();
  private unique: FieldUnique = FieldUnique.disabled();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): LinkFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): LinkFieldBuilder {
    this.id = id;
    return this;
  }

  withConfig(config: LinkFieldConfig): LinkFieldBuilder {
    this.config = config;
    return this;
  }

  withMeta(meta: LinkFieldMeta): LinkFieldBuilder {
    this.meta = meta;
    return this;
  }

  withNotNull(notNull: FieldNotNull): LinkFieldBuilder {
    this.notNull = notNull;
    return this;
  }

  withUnique(unique: FieldUnique): LinkFieldBuilder {
    this.unique = unique;
    return this;
  }

  primary(): LinkFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }
    const config = this.config;
    if (!config) {
      this.sink.addError(linkConfigRequiredError);
      return this.parent;
    }

    const baseIdResult = this.parent.requireBaseId();
    if (baseIdResult.isErr()) {
      this.sink.addError(baseIdResult.error);
      return this.parent;
    }
    const tableIdResult = this.parent.ensureTableId();
    if (tableIdResult.isErr()) {
      this.sink.addError(tableIdResult.error);
      return this.parent;
    }

    const result = resolveFieldId(this.id).andThen((id) =>
      createNewLinkField({
        id,
        name,
        config,
        meta: this.meta,
        baseId: baseIdResult.value,
        hostTableId: tableIdResult.value,
      })
        .andThen((field) => applyFieldValidation(field, this.notNull, this.unique))
        .andThen((field) => {
          if (!this.isPrimary) return ok(field);
          return this.parent.markPrimaryFieldId(field.id()).map(() => field);
        })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class ConditionalRollupFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private config: ConditionalRollupConfig | undefined;
  private expression: RollupExpression | undefined;
  private valuesField: Field | undefined;
  private timeZone: TimeZone | undefined;
  private formatting: ConditionalRollupFormatting | undefined;
  private showAs: ConditionalRollupShowAs | undefined;
  private resultType:
    | { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity }
    | undefined;
  private dependencies: ReadonlyArray<FieldId> = [];
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): ConditionalRollupFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): ConditionalRollupFieldBuilder {
    this.id = id;
    return this;
  }

  withConfig(config: ConditionalRollupConfig): ConditionalRollupFieldBuilder {
    this.config = config;
    return this;
  }

  withExpression(expression: RollupExpression): ConditionalRollupFieldBuilder {
    this.expression = expression;
    return this;
  }

  withValuesField(valuesField: Field): ConditionalRollupFieldBuilder {
    this.valuesField = valuesField;
    return this;
  }

  withTimeZone(timeZone: TimeZone): ConditionalRollupFieldBuilder {
    this.timeZone = timeZone;
    return this;
  }

  withFormatting(formatting: ConditionalRollupFormatting): ConditionalRollupFieldBuilder {
    this.formatting = formatting;
    return this;
  }

  withShowAs(showAs: ConditionalRollupShowAs): ConditionalRollupFieldBuilder {
    this.showAs = showAs;
    return this;
  }

  withResultType(resultType: {
    cellValueType: CellValueType;
    isMultipleCellValue: CellValueMultiplicity;
  }): ConditionalRollupFieldBuilder {
    this.resultType = resultType;
    return this;
  }

  withDependencies(dependencies: ReadonlyArray<FieldId>): ConditionalRollupFieldBuilder {
    this.dependencies = [...dependencies];
    return this;
  }

  primary(): ConditionalRollupFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }
    const config = this.config;
    if (!config) {
      this.sink.addError(conditionalRollupConfigRequiredError);
      return this.parent;
    }
    const expression = this.expression;
    if (!expression) {
      this.sink.addError(conditionalRollupExpressionRequiredError);
      return this.parent;
    }
    const valuesField = this.valuesField;

    const result = resolveFieldId(this.id).andThen((id) =>
      (valuesField
        ? ConditionalRollupField.create({
            id,
            name,
            config,
            expression,
            valuesField,
            timeZone: this.timeZone,
            formatting: this.formatting,
            showAs: this.showAs,
            dependencies: this.dependencies,
          })
        : ConditionalRollupField.createPending({
            id,
            name,
            config,
            expression,
            timeZone: this.timeZone,
            formatting: this.formatting,
            showAs: this.showAs,
            resultType: this.resultType,
            dependencies: this.dependencies,
          })
      ).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class ConditionalLookupFieldBuilder {
  private id: FieldId | undefined;
  private name: FieldName | undefined;
  private conditionalLookupOptions: ConditionalLookupOptions | undefined;
  private innerField: Field | undefined;
  private dependencies: ReadonlyArray<FieldId> = [];
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): ConditionalLookupFieldBuilder {
    this.name = name;
    return this;
  }

  withId(id: FieldId): ConditionalLookupFieldBuilder {
    this.id = id;
    return this;
  }

  withConditionalLookupOptions(options: ConditionalLookupOptions): ConditionalLookupFieldBuilder {
    this.conditionalLookupOptions = options;
    return this;
  }

  /**
   * Set the inner field that defines the lookup value type and formatting.
   * This should be a field that matches the type of the field being looked up.
   */
  withInnerField(innerField: Field): ConditionalLookupFieldBuilder {
    this.innerField = innerField;
    return this;
  }

  withDependencies(dependencies: ReadonlyArray<FieldId>): ConditionalLookupFieldBuilder {
    this.dependencies = [...dependencies];
    return this;
  }

  primary(): ConditionalLookupFieldBuilder {
    this.isPrimary = true;
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(fieldNameRequiredError);
      return this.parent;
    }
    const options = this.conditionalLookupOptions;
    if (!options) {
      this.sink.addError(conditionalLookupOptionsRequiredError);
      return this.parent;
    }
    const innerField = this.innerField;

    const result = resolveFieldId(this.id).andThen((id) =>
      (innerField
        ? ConditionalLookupField.create({
            id,
            name,
            innerField,
            conditionalLookupOptions: options,
            dependencies: this.dependencies,
          })
        : ConditionalLookupField.createPending({
            id,
            name,
            conditionalLookupOptions: options,
            dependencies: this.dependencies,
          })
      ).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class TableViewBuilder {
  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: ViewName): GridViewBuilder {
    return this.grid().withName(name);
  }

  defaultGrid(): GridViewBuilder {
    return this.grid().defaultName();
  }

  grid(): GridViewBuilder {
    return new GridViewBuilder(this.parent, this.sink);
  }

  kanban(): KanbanViewBuilder {
    return new KanbanViewBuilder(this.parent, this.sink);
  }

  gallery(): GalleryViewBuilder {
    return new GalleryViewBuilder(this.parent, this.sink);
  }

  calendar(): CalendarViewBuilder {
    return new CalendarViewBuilder(this.parent, this.sink);
  }

  form(): FormViewBuilder {
    return new FormViewBuilder(this.parent, this.sink);
  }

  plugin(): PluginViewBuilder {
    return new PluginViewBuilder(this.parent, this.sink);
  }
}

export class GridViewBuilder {
  private name: ViewName | undefined;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: ViewName): GridViewBuilder {
    this.name = name;
    return this;
  }

  defaultName(): GridViewBuilder {
    this.setDefaultName('Grid');
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(viewNameRequiredError);
      return this.parent;
    }

    const result = ViewId.generate().andThen((id) => GridView.create({ id, name }));
    this.sink.addViewResult(result);
    return this.parent;
  }

  private setDefaultName(rawName: string): void {
    ViewName.create(rawName).match(
      (name) => {
        this.name = name;
      },
      (e) => {
        this.sink.addError(e);
      }
    );
  }
}

export class KanbanViewBuilder {
  private name: ViewName | undefined;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: ViewName): KanbanViewBuilder {
    this.name = name;
    return this;
  }

  defaultName(): KanbanViewBuilder {
    this.setDefaultName('Kanban');
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(viewNameRequiredError);
      return this.parent;
    }

    const result = ViewId.generate().andThen((id) => KanbanView.create({ id, name }));
    this.sink.addViewResult(result);
    return this.parent;
  }

  private setDefaultName(rawName: string): void {
    ViewName.create(rawName).match(
      (name) => {
        this.name = name;
      },
      (e) => {
        this.sink.addError(e);
      }
    );
  }
}

export class GalleryViewBuilder {
  private name: ViewName | undefined;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: ViewName): GalleryViewBuilder {
    this.name = name;
    return this;
  }

  defaultName(): GalleryViewBuilder {
    this.setDefaultName('Gallery');
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(viewNameRequiredError);
      return this.parent;
    }

    const result = ViewId.generate().andThen((id) => GalleryView.create({ id, name }));
    this.sink.addViewResult(result);
    return this.parent;
  }

  private setDefaultName(rawName: string): void {
    ViewName.create(rawName).match(
      (name) => {
        this.name = name;
      },
      (e) => {
        this.sink.addError(e);
      }
    );
  }
}

export class CalendarViewBuilder {
  private name: ViewName | undefined;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: ViewName): CalendarViewBuilder {
    this.name = name;
    return this;
  }

  defaultName(): CalendarViewBuilder {
    this.setDefaultName('Calendar');
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(viewNameRequiredError);
      return this.parent;
    }

    const result = ViewId.generate().andThen((id) => CalendarView.create({ id, name }));
    this.sink.addViewResult(result);
    return this.parent;
  }

  private setDefaultName(rawName: string): void {
    ViewName.create(rawName).match(
      (name) => {
        this.name = name;
      },
      (e) => {
        this.sink.addError(e);
      }
    );
  }
}

export class FormViewBuilder {
  private name: ViewName | undefined;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: ViewName): FormViewBuilder {
    this.name = name;
    return this;
  }

  defaultName(): FormViewBuilder {
    this.setDefaultName('Form');
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(viewNameRequiredError);
      return this.parent;
    }

    const result = ViewId.generate().andThen((id) => FormView.create({ id, name }));
    this.sink.addViewResult(result);
    return this.parent;
  }

  private setDefaultName(rawName: string): void {
    ViewName.create(rawName).match(
      (name) => {
        this.name = name;
      },
      (e) => {
        this.sink.addError(e);
      }
    );
  }
}

export class PluginViewBuilder {
  private name: ViewName | undefined;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: ViewName): PluginViewBuilder {
    this.name = name;
    return this;
  }

  defaultName(): PluginViewBuilder {
    this.setDefaultName('Plugin');
    return this;
  }

  done(): TableBuilder {
    const name = this.name;
    if (!name) {
      this.sink.addError(viewNameRequiredError);
      return this.parent;
    }

    const result = ViewId.generate().andThen((id) => PluginView.create({ id, name }));
    this.sink.addViewResult(result);
    return this.parent;
  }

  private setDefaultName(rawName: string): void {
    ViewName.create(rawName).match(
      (name) => {
        this.name = name;
      },
      (e) => {
        this.sink.addError(e);
      }
    );
  }
}
