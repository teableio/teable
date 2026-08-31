import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { FieldValueTypeVisitor } from '../fields/visitors/FieldValueTypeVisitor';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import { ViewColumnMeta, type ViewColumnMetaValue } from '../views/ViewColumnMeta';
import { createView as createViewEntity } from '../views/ViewFactory';
import { ViewId } from '../views/ViewId';
import { ViewName } from '../views/ViewName';
import { validateViewCreateOptions } from '../views/ViewOptions';
import { ViewOrder } from '../views/ViewOrder';
import { ViewProperties, type ViewShareMetaValue } from '../views/ViewProperties';
import {
  ViewQueryDefaults,
  type ViewQueryDefaultsDTO,
  type ViewQueryGroupItem,
  type ViewQuerySortItem,
} from '../views/ViewQueryDefaults';
import type { IViewTypeLiteral } from '../views/ViewType';

export type CreateViewMethodParams = {
  readonly name?: string;
  readonly type: IViewTypeLiteral;
  readonly description?: string;
  readonly columnMeta?: ViewColumnMetaValue;
  readonly options?: unknown;
  readonly filter?: ViewQueryDefaultsDTO['filter'];
  readonly sourceFilter?: unknown;
  readonly sort?: ReadonlyArray<ViewQuerySortItem>;
  readonly group?: ReadonlyArray<ViewQueryGroupItem>;
  readonly manualSort?: boolean;
  readonly isLocked?: boolean;
  /** Explicit persisted order (import/duplicate fidelity); defaults to append-at-end. */
  readonly order?: number;
  readonly enableShare?: boolean;
  readonly shareId?: string;
  readonly shareMeta?: ViewShareMetaValue;
};

export type CreateViewMethodResult = {
  readonly view: View;
  readonly updateResult: TableUpdateResult;
};

export const uniqueViewName = (name: string, existingNames: ReadonlyArray<string>): string => {
  if (!existingNames.includes(name)) return name;

  let baseName = name;
  let suffix = 2;
  if (Number.isNaN(Number(name))) {
    const match = name.match(/^(.*)(\b\d+)$/);
    if (match) {
      baseName = match[1]?.trim() ?? name;
      suffix = Number.parseInt(match[2] ?? `${suffix}`, 10);
    }
  }
  while (existingNames.includes(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
};

const mergeColumnMeta = (
  defaults: ViewColumnMetaValue,
  overrides?: ViewColumnMetaValue
): ViewColumnMetaValue =>
  Object.fromEntries(
    Object.entries(defaults).map(([fieldId, entry]) => [
      fieldId,
      {
        ...entry,
        ...overrides?.[fieldId],
        ...(entry.visible === true ? { visible: true } : {}),
      },
    ])
  );

const asOptionsRecord = (options: unknown): Record<string, unknown> =>
  options && typeof options === 'object' && !Array.isArray(options)
    ? { ...(options as Record<string, unknown>) }
    : {};

const applyTypeDefaults = (
  table: Table,
  type: IViewTypeLiteral,
  inputOptions: unknown
): Result<unknown, DomainError> => {
  if (type === 'gallery') {
    const options = asOptionsRecord(inputOptions);
    const coverFieldId =
      options.coverFieldId ??
      table
        .getFields()
        .find((field) => field.type().toString() === 'attachment')
        ?.id()
        .toString();
    return ok({
      ...options,
      ...(coverFieldId !== undefined ? { coverFieldId } : {}),
    });
  }

  if (type !== 'calendar') return ok(inputOptions);

  return safeTry<unknown, DomainError>(function* () {
    const dateFieldIds: string[] = [];
    const visitor = new FieldValueTypeVisitor();
    for (const field of table.getFields()) {
      const valueType = yield* field.accept(visitor);
      if (
        valueType.cellValueType.toString() === 'dateTime' &&
        !valueType.isMultipleCellValue.toBoolean()
      ) {
        dateFieldIds.push(field.id().toString());
      }
    }
    if (!dateFieldIds.length) return ok(inputOptions);

    const options = asOptionsRecord(inputOptions);
    return ok({
      ...options,
      startDateFieldId: options.startDateFieldId ?? dateFieldIds[0],
      endDateFieldId: options.endDateFieldId ?? dateFieldIds[1] ?? dateFieldIds[0],
    });
  });
};

export function createView(
  this: Table,
  input: CreateViewMethodParams
): Result<CreateViewMethodResult, DomainError> {
  const table = this;
  return safeTry<CreateViewMethodResult, DomainError>(function* () {
    const viewId = yield* ViewId.generate();
    const name = yield* ViewName.create(
      uniqueViewName(
        input.name ?? 'New view',
        table.views().map((view) => view.name().toString())
      )
    );
    const properties = yield* ViewProperties.create({
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isLocked !== undefined ? { isLocked: input.isLocked } : {}),
      ...(input.enableShare !== undefined ? { enableShare: input.enableShare } : {}),
      ...(input.shareId !== undefined ? { shareId: input.shareId } : {}),
      ...(input.shareMeta !== undefined ? { shareMeta: input.shareMeta } : {}),
    });
    const view = yield* createViewEntity({
      type: input.type,
      id: viewId,
      name,
      properties,
    });
    const defaultColumnMeta = yield* ViewColumnMeta.forView({
      viewType: view.type(),
      fields: table.getFields(),
      primaryFieldId: table.primaryFieldId(),
    });
    const columnMeta = yield* ViewColumnMeta.create(
      mergeColumnMeta(defaultColumnMeta.toDto(), input.columnMeta)
    );

    yield* view.setColumnMeta(columnMeta);
    const queryDefaults = yield* ViewQueryDefaults.create(
      {
        ...(input.filter !== undefined ? { filter: input.filter } : {}),
        ...(input.sort !== undefined ? { sort: [...input.sort] } : {}),
        ...(input.group !== undefined ? { group: [...input.group] } : {}),
        ...(input.manualSort !== undefined ? { manualSort: input.manualSort } : {}),
      },
      { sourceFilter: input.sourceFilter }
    );
    yield* view.setQueryDefaults(queryDefaults);
    const options = yield* applyTypeDefaults(table, input.type, input.options);
    const validatedOptions = yield* validateViewCreateOptions(input.type, options);
    yield* view.setOptions(validatedOptions);
    if (input.order !== undefined) {
      const orderValue = yield* ViewOrder.rehydrate(input.order);
      yield* view.setOrder(orderValue);
    }

    const updateResult = yield* table.update((mutator) => mutator.addView(view));
    return ok({ view, updateResult });
  });
}
