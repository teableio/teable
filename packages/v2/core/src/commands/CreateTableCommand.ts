import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import { match } from 'ts-pattern';

import { BaseId } from '../domain/base/BaseId';
import { FieldName } from '../domain/table/fields/FieldName';
import { RatingMax } from '../domain/table/fields/types/RatingMax';
import { SelectOptionName } from '../domain/table/fields/types/SelectOptionName';
import type { TableBuilder } from '../domain/table/TableBuilder';
import { TableName } from '../domain/table/TableName';
import { ViewName } from '../domain/table/views/ViewName';

export const createTableInputSchema = z.object({
  baseId: z.string(),
  name: z.string(),
  fields: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('singleLineText'),
          name: z.string(),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('longText'),
          name: z.string(),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('number'),
          name: z.string(),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('rating'),
          name: z.string(),
          max: z.number().optional(),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('singleSelect'),
          name: z.string(),
          options: z.array(z.string()),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('multipleSelect'),
          name: z.string(),
          options: z.array(z.string()),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('checkbox'),
          name: z.string(),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('attachment'),
          name: z.string(),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('date'),
          name: z.string(),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('user'),
          name: z.string(),
          isPrimary: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('button'),
          name: z.string(),
          isPrimary: z.boolean().optional(),
        }),
      ])
    )
    .default([]),
  views: z
    .array(
      z.object({
        type: z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']).optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
});

export type ICreateTableCommandInput = z.input<typeof createTableInputSchema>;

export interface ICreateTableFieldSpec {
  applyTo(builder: TableBuilder): void;
}

export interface ICreateTableViewSpec {
  applyTo(builder: TableBuilder): void;
}

class CreateGridViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateGridViewSpec {
    return new CreateGridViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().grid().withName(this.name).done();
  }
}

class CreateKanbanViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateKanbanViewSpec {
    return new CreateKanbanViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().kanban().withName(this.name).done();
  }
}

class CreateGalleryViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateGalleryViewSpec {
    return new CreateGalleryViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().gallery().withName(this.name).done();
  }
}

class CreateCalendarViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateCalendarViewSpec {
    return new CreateCalendarViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().calendar().withName(this.name).done();
  }
}

class CreateFormViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreateFormViewSpec {
    return new CreateFormViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().form().withName(this.name).done();
  }
}

class CreatePluginViewSpec implements ICreateTableViewSpec {
  private constructor(private readonly name: ViewName) {}

  static create(name: ViewName): CreatePluginViewSpec {
    return new CreatePluginViewSpec(name);
  }

  applyTo(builder: TableBuilder): void {
    builder.view().plugin().withName(this.name).done();
  }
}

class CreateSingleLineTextFieldSpec implements ICreateTableFieldSpec {
  private constructor(private readonly name: FieldName) {}

  static create(name: FieldName, options: { isPrimary: boolean }): CreateSingleLineTextFieldSpec {
    return new CreateSingleLineTextFieldSpec(name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().singleLineText().withName(this.name);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateSingleLineTextFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateLongTextFieldSpec implements ICreateTableFieldSpec {
  private constructor(private readonly name: FieldName) {}

  static create(name: FieldName, options: { isPrimary: boolean }): CreateLongTextFieldSpec {
    return new CreateLongTextFieldSpec(name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().longText().withName(this.name);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateLongTextFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateNumberFieldSpec implements ICreateTableFieldSpec {
  private constructor(private readonly name: FieldName) {}

  static create(name: FieldName, options: { isPrimary: boolean }): CreateNumberFieldSpec {
    return new CreateNumberFieldSpec(name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().number().withName(this.name);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateNumberFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateRatingFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly name: FieldName,
    private readonly max: RatingMax
  ) {}

  static create(
    name: FieldName,
    max: RatingMax,
    options: { isPrimary: boolean }
  ): CreateRatingFieldSpec {
    return new CreateRatingFieldSpec(name, max).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().rating().withName(this.name).withMax(this.max);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateRatingFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateSingleSelectFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly name: FieldName,
    private readonly options: ReadonlyArray<SelectOptionName>
  ) {}

  static create(
    name: FieldName,
    options: ReadonlyArray<SelectOptionName>,
    meta: { isPrimary: boolean }
  ): CreateSingleSelectFieldSpec {
    return new CreateSingleSelectFieldSpec(name, options).withPrimary(meta.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .singleSelect()
      .withName(this.name)
      .withOptions(this.options);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateSingleSelectFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateMultipleSelectFieldSpec implements ICreateTableFieldSpec {
  private constructor(
    private readonly name: FieldName,
    private readonly options: ReadonlyArray<SelectOptionName>
  ) {}

  static create(
    name: FieldName,
    options: ReadonlyArray<SelectOptionName>,
    meta: { isPrimary: boolean }
  ): CreateMultipleSelectFieldSpec {
    return new CreateMultipleSelectFieldSpec(name, options).withPrimary(meta.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder
      .field()
      .multipleSelect()
      .withName(this.name)
      .withOptions(this.options);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateMultipleSelectFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateCheckboxFieldSpec implements ICreateTableFieldSpec {
  private constructor(private readonly name: FieldName) {}

  static create(name: FieldName, options: { isPrimary: boolean }): CreateCheckboxFieldSpec {
    return new CreateCheckboxFieldSpec(name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().checkbox().withName(this.name);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateCheckboxFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateAttachmentFieldSpec implements ICreateTableFieldSpec {
  private constructor(private readonly name: FieldName) {}

  static create(name: FieldName, options: { isPrimary: boolean }): CreateAttachmentFieldSpec {
    return new CreateAttachmentFieldSpec(name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().attachment().withName(this.name);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateAttachmentFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateDateFieldSpec implements ICreateTableFieldSpec {
  private constructor(private readonly name: FieldName) {}

  static create(name: FieldName, options: { isPrimary: boolean }): CreateDateFieldSpec {
    return new CreateDateFieldSpec(name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().date().withName(this.name);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateDateFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateUserFieldSpec implements ICreateTableFieldSpec {
  private constructor(private readonly name: FieldName) {}

  static create(name: FieldName, options: { isPrimary: boolean }): CreateUserFieldSpec {
    return new CreateUserFieldSpec(name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().user().withName(this.name);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateUserFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

class CreateButtonFieldSpec implements ICreateTableFieldSpec {
  private constructor(private readonly name: FieldName) {}

  static create(name: FieldName, options: { isPrimary: boolean }): CreateButtonFieldSpec {
    return new CreateButtonFieldSpec(name).withPrimary(options.isPrimary);
  }

  applyTo(builder: TableBuilder): void {
    const fieldBuilder = builder.field().button().withName(this.name);
    if (this.isPrimary) fieldBuilder.primary();
    fieldBuilder.done();
  }

  private isPrimary = false;

  private withPrimary(isPrimary: boolean): CreateButtonFieldSpec {
    this.isPrimary = isPrimary;
    return this;
  }
}

const sequence = <T>(values: ReadonlyArray<Result<T, string>>): Result<ReadonlyArray<T>, string> =>
  values.reduce<Result<ReadonlyArray<T>, string>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );

export class CreateTableCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableName: TableName,
    readonly fields: ReadonlyArray<ICreateTableFieldSpec>,
    readonly views: ReadonlyArray<ICreateTableViewSpec>
  ) {}

  static create(raw: unknown): Result<CreateTableCommand, string> {
    const parsed = createTableInputSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid CreateTableCommand input');

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableName.create(parsed.data.name).andThen((tableName) =>
        this.parseFields(parsed.data.fields)
          .andThen((fields) =>
            this.parseViews(parsed.data.views).map((views) => ({ fields, views }))
          )
          .map(({ fields, views }) => new CreateTableCommand(baseId, tableName, fields, views))
      )
    );
  }

  private static parseFields(
    rawFields: ReadonlyArray<z.output<typeof createTableInputSchema>['fields'][number]>
  ): Result<ReadonlyArray<ICreateTableFieldSpec>, string> {
    const fieldsToUse =
      rawFields.length > 0
        ? rawFields
        : [{ type: 'singleLineText' as const, name: 'Name', isPrimary: true }];

    const primaryIndexes = fieldsToUse
      .map((f, i) => ({ isPrimary: f.isPrimary === true, i }))
      .filter((x) => x.isPrimary)
      .map((x) => x.i);

    if (primaryIndexes.length > 1)
      return err('CreateTableCommand requires exactly one primary Field');

    const primaryIndex = primaryIndexes[0] ?? 0;

    const specs = fieldsToUse.map((field, index) => {
      const isPrimary = index === primaryIndex;
      return FieldName.create(field.name).andThen((name) => {
        return match(field)
          .with({ type: 'singleLineText' }, () =>
            ok(CreateSingleLineTextFieldSpec.create(name, { isPrimary }))
          )
          .with({ type: 'longText' }, () => ok(CreateLongTextFieldSpec.create(name, { isPrimary })))
          .with({ type: 'number' }, () => ok(CreateNumberFieldSpec.create(name, { isPrimary })))
          .with({ type: 'rating' }, (field) =>
            (field.max === undefined ? ok(RatingMax.five()) : RatingMax.create(field.max)).map(
              (max) => CreateRatingFieldSpec.create(name, max, { isPrimary })
            )
          )
          .with({ type: 'singleSelect' }, (field) =>
            sequence(field.options.map((o) => SelectOptionName.create(o))).map((options) =>
              CreateSingleSelectFieldSpec.create(name, options, { isPrimary })
            )
          )
          .with({ type: 'multipleSelect' }, (field) =>
            sequence(field.options.map((o) => SelectOptionName.create(o))).map((options) =>
              CreateMultipleSelectFieldSpec.create(name, options, { isPrimary })
            )
          )
          .with({ type: 'checkbox' }, () => ok(CreateCheckboxFieldSpec.create(name, { isPrimary })))
          .with({ type: 'attachment' }, () =>
            ok(CreateAttachmentFieldSpec.create(name, { isPrimary }))
          )
          .with({ type: 'date' }, () => ok(CreateDateFieldSpec.create(name, { isPrimary })))
          .with({ type: 'user' }, () => ok(CreateUserFieldSpec.create(name, { isPrimary })))
          .with({ type: 'button' }, () => ok(CreateButtonFieldSpec.create(name, { isPrimary })))
          .exhaustive();
      });
    });

    return sequence(specs);
  }

  private static parseViews(
    rawViews: z.output<typeof createTableInputSchema>['views']
  ): Result<ReadonlyArray<ICreateTableViewSpec>, string> {
    const viewsToUse =
      rawViews && rawViews.length > 0 ? rawViews : [{ type: 'grid' as const, name: 'Grid' }];

    const defaultViewNameByType = (type: string): string =>
      match(type)
        .with('calendar', () => 'Calendar')
        .with('kanban', () => 'Kanban')
        .with('form', () => 'Form')
        .with('gallery', () => 'Gallery')
        .with('plugin', () => 'Plugin')
        .otherwise(() => 'Grid');

    const specs = viewsToUse.map((view) => {
      const type = view.type ?? 'grid';
      const rawName = view.name ?? defaultViewNameByType(type);

      return ViewName.create(rawName).andThen((name) => {
        return match(type)
          .with('grid', () => ok(CreateGridViewSpec.create(name)))
          .with('kanban', () => ok(CreateKanbanViewSpec.create(name)))
          .with('gallery', () => ok(CreateGalleryViewSpec.create(name)))
          .with('calendar', () => ok(CreateCalendarViewSpec.create(name)))
          .with('form', () => ok(CreateFormViewSpec.create(name)))
          .with('plugin', () => ok(CreatePluginViewSpec.create(name)))
          .otherwise(() => err('Unsupported view type'));
      });
    });

    return sequence(specs);
  }
}
