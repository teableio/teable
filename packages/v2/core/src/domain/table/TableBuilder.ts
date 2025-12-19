import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../base/BaseId';
import type { Field } from './fields/Field';
import { FieldId } from './fields/FieldId';
import type { FieldName } from './fields/FieldName';
import { NumberField } from './fields/types/NumberField';
import { RatingField } from './fields/types/RatingField';
import { RatingMax } from './fields/types/RatingMax';
import type { SelectOptionName } from './fields/types/SelectOptionName';
import { SingleLineTextField } from './fields/types/SingleLineTextField';
import { SingleSelectField } from './fields/types/SingleSelectField';
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
import { ViewId } from './views/ViewId';
import { ViewName } from './views/ViewName';

export interface ITableBuildProps {
  id: TableId;
  baseId: BaseId;
  name: TableName;
  fields: ReadonlyArray<Field>;
  views: ReadonlyArray<View>;
  primaryFieldId: FieldId;
}

export type ITableFactory = (props: ITableBuildProps) => Table;

export interface ITableBuilderSink {
  addError(message: string): void;
  addFieldResult(result: Result<Field, string>): void;
  addViewResult(result: Result<View, string>): void;
}

const fieldNameRequiredError = 'FieldName is required';
const viewNameRequiredError = 'ViewName is required';

const isUniqueByStringValue = (values: ReadonlyArray<{ toString(): string }>): boolean => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toString();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};

export class TableBuilder {
  private tableId: TableId | undefined;
  private baseId: BaseId | undefined;
  private tableName: TableName | undefined;
  private readonly fields: Field[] = [];
  private readonly views: View[] = [];
  private readonly errors: string[] = [];
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

  build(): Result<Table, string> {
    const tableName = this.tableName;
    if (!tableName) return err('TableName is required');
    const baseId = this.baseId;
    if (!baseId) return err('BaseId is required');

    if (this.errors.length > 0) return err(this.errors.join('; '));

    if (this.fields.length === 0) return err('Table requires at least one Field');
    if (this.views.length === 0) return err('Table requires at least one View');
    if (!isUniqueByStringValue(this.views.map((v) => v.name())))
      return err('View names must be unique');

    if (!isUniqueByStringValue(this.fields.map((f) => f.name())))
      return err('Field names must be unique');

    const primaryFieldId = this.primaryFieldId ?? this.fields[0]?.id();
    if (!primaryFieldId) return err('Table requires a primary Field');
    if (!this.fields.some((f) => f.id().equals(primaryFieldId)))
      return err('Primary Field must exist in Table fields');

    const idResult = this.tableId ? ok(this.tableId) : TableId.generate();

    return idResult.map((id) =>
      this.factory({
        id,
        baseId,
        name: tableName,
        fields: [...this.fields],
        views: [...this.views],
        primaryFieldId,
      })
    );
  }

  private sink(): ITableBuilderSink {
    return {
      addError: (message) => this.addError(message),
      addFieldResult: (result) => this.addFieldResult(result),
      addViewResult: (result) => this.addViewResult(result),
    };
  }

  private addError(message: string): void {
    this.errors.push(message);
  }

  private addField(field: Field): void {
    this.fields.push(field);
  }

  private addView(view: View): void {
    this.views.push(view);
  }

  private addFieldResult(result: Result<Field, string>): void {
    result.match(
      (field) => this.addField(field),
      (e) => this.addError(e)
    );
  }

  private addViewResult(result: Result<View, string>): void {
    result.match(
      (view) => this.addView(view),
      (e) => this.addError(e)
    );
  }

  markPrimaryFieldId(fieldId: FieldId): Result<void, string> {
    if (this.primaryFieldId) return err('Table can only have one primary Field');
    this.primaryFieldId = fieldId;
    return ok(undefined);
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

  number(): NumberFieldBuilder {
    return new NumberFieldBuilder(this.parent, this.sink);
  }

  rating(): RatingFieldBuilder {
    return new RatingFieldBuilder(this.parent, this.sink);
  }

  singleSelect(): SingleSelectFieldBuilder {
    return new SingleSelectFieldBuilder(this.parent, this.sink);
  }
}

export class SingleLineTextFieldBuilder {
  private name: FieldName | undefined;
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): SingleLineTextFieldBuilder {
    this.name = name;
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

    const result = FieldId.generate().andThen((id) =>
      SingleLineTextField.create({ id, name }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class NumberFieldBuilder {
  private name: FieldName | undefined;
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): NumberFieldBuilder {
    this.name = name;
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

    const result = FieldId.generate().andThen((id) =>
      NumberField.create({ id, name }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class RatingFieldBuilder {
  private name: FieldName | undefined;
  private max: RatingMax = RatingMax.five();
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): RatingFieldBuilder {
    this.name = name;
    return this;
  }

  withMax(max: RatingMax): RatingFieldBuilder {
    this.max = max;
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

    const result = FieldId.generate().andThen((id) =>
      RatingField.create({ id, name, max: this.max }).andThen((field) => {
        if (!this.isPrimary) return ok(field);
        return this.parent.markPrimaryFieldId(field.id()).map(() => field);
      })
    );
    this.sink.addFieldResult(result);
    return this.parent;
  }
}

export class SingleSelectFieldBuilder {
  private name: FieldName | undefined;
  private options: ReadonlyArray<SelectOptionName> = [];
  private isPrimary = false;

  constructor(
    private readonly parent: TableBuilder,
    private readonly sink: ITableBuilderSink
  ) {}

  withName(name: FieldName): SingleSelectFieldBuilder {
    this.name = name;
    return this;
  }

  withOptions(options: ReadonlyArray<SelectOptionName>): SingleSelectFieldBuilder {
    this.options = [...options];
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

    const result = FieldId.generate().andThen((id) =>
      SingleSelectField.create({ id, name, options: this.options }).andThen((field) => {
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
