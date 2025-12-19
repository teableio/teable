import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

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
        switch (field.type) {
          case 'singleLineText':
            return ok(CreateSingleLineTextFieldSpec.create(name, { isPrimary }));
          case 'number':
            return ok(CreateNumberFieldSpec.create(name, { isPrimary }));
          case 'rating':
            return (
              field.max === undefined ? ok(RatingMax.five()) : RatingMax.create(field.max)
            ).map((max) => CreateRatingFieldSpec.create(name, max, { isPrimary }));
          case 'singleSelect':
            return sequence(field.options.map((o) => SelectOptionName.create(o))).map((options) =>
              CreateSingleSelectFieldSpec.create(name, options, { isPrimary })
            );
        }
      });
    });

    return sequence(specs);
  }

  private static parseViews(
    rawViews: z.output<typeof createTableInputSchema>['views']
  ): Result<ReadonlyArray<ICreateTableViewSpec>, string> {
    const viewsToUse =
      rawViews && rawViews.length > 0 ? rawViews : [{ type: 'grid' as const, name: 'Grid' }];

    const defaultViewNameByType = (type: string): string => {
      switch (type) {
        case 'calendar':
          return 'Calendar';
        case 'kanban':
          return 'Kanban';
        case 'form':
          return 'Form';
        case 'gallery':
          return 'Gallery';
        case 'plugin':
          return 'Plugin';
        case 'grid':
        default:
          return 'Grid';
      }
    };

    const specs = viewsToUse.map((view) => {
      const type = view.type ?? 'grid';
      const rawName = view.name ?? defaultViewNameByType(type);

      return ViewName.create(rawName).andThen((name) => {
        switch (type) {
          case 'grid':
            return ok(CreateGridViewSpec.create(name));
          case 'kanban':
            return ok(CreateKanbanViewSpec.create(name));
          case 'gallery':
            return ok(CreateGalleryViewSpec.create(name));
          case 'calendar':
            return ok(CreateCalendarViewSpec.create(name));
          case 'form':
            return ok(CreateFormViewSpec.create(name));
          case 'plugin':
            return ok(CreatePluginViewSpec.create(name));
          default:
            return err('Unsupported view type');
        }
      });
    });

    return sequence(specs);
  }
}
