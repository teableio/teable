import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import type {
  ITableMapper,
  ITableFieldPersistenceDTO,
  ITablePersistenceDTO,
} from '../../../ports/mappers/TableMapper';
import type { DomainError } from '../../shared/DomainError';
import { TableCreated } from '../events/TableCreated';
import { LinkField } from '../fields/types/LinkField';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import type { Table } from '../Table';
import { TableId } from '../TableId';
import type { TableName } from '../TableName';
import { FieldId } from '../fields/FieldId';
import { ViewId } from '../views/ViewId';

export type DuplicateMethodParams = {
  mapper: ITableMapper;
  newName: TableName;
  newId?: TableId;
};

export type DuplicateMethodResult = {
  table: Table;
  fieldIdMap: ReadonlyMap<string, string>;
  viewIdMap: ReadonlyMap<string, string>;
};

type DuplicateRewriteContext = {
  sourceTableId: string;
  duplicatedTableId: string;
  duplicatedBaseId: string;
  fieldIdMap: ReadonlyMap<string, string>;
  viewIdMap: ReadonlyMap<string, string>;
};

type LinkFieldOptionsValue = Extract<ITableFieldPersistenceDTO, { type: 'link' }>['options'];

const remapFormulaExpression = (
  expression: string,
  fieldIdMap: ReadonlyMap<string, string>
): string => {
  if (!expression.includes('{')) return expression;
  return expression.replace(/\{(fld[a-zA-Z0-9]+)\}/g, (_token, rawFieldId) => {
    return `{${fieldIdMap.get(rawFieldId) ?? rawFieldId}}`;
  });
};

const remapFieldIdKeyRecord = (
  value: Record<string, unknown>,
  fieldIdMap: ReadonlyMap<string, string>
): Record<string, unknown> => {
  return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, entryValue]) => {
    acc[fieldIdMap.get(key) ?? key] = entryValue;
    return acc;
  }, {});
};

const deepRemapTableScopedIds = (
  value: unknown,
  context: DuplicateRewriteContext,
  currentKey?: string
): unknown => {
  if (typeof value === 'string') {
    if (context.fieldIdMap.has(value)) return context.fieldIdMap.get(value);
    if (context.viewIdMap.has(value)) return context.viewIdMap.get(value);
    if (value === context.sourceTableId) return context.duplicatedTableId;
    return remapFormulaExpression(value, context.fieldIdMap);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepRemapTableScopedIds(item, context));
  }

  if (value && typeof value === 'object') {
    const normalizedValue =
      currentKey === 'columnMeta'
        ? remapFieldIdKeyRecord(value as Record<string, unknown>, context.fieldIdMap)
        : (value as Record<string, unknown>);

    return Object.entries(normalizedValue).reduce<Record<string, unknown>>(
      (acc, [key, entryValue]) => {
        acc[key] = deepRemapTableScopedIds(entryValue, context, key);
        return acc;
      },
      {}
    );
  }

  return value;
};

const sanitizeFieldPersistenceDto = (
  field: ITableFieldPersistenceDTO
): ITableFieldPersistenceDTO => {
  const { dbFieldName: _dbFieldName, dbFieldType: _dbFieldType, ...rest } = field;

  if (rest.type === 'link') {
    const {
      fkHostTableName: _fkHostTableName,
      selfKeyName: _selfKeyName,
      foreignKeyName: _foreignKeyName,
      ...linkOptions
    } = rest.options;

    return {
      ...rest,
      options: linkOptions,
    };
  }

  if (rest.type === 'button') {
    const { workflow: _workflow, ...buttonOptions } = rest.options ?? {};
    return {
      ...rest,
      options: buttonOptions,
    };
  }

  return rest;
};

const normalizeDuplicatedLinkOptions = (
  options: LinkFieldOptionsValue,
  context: DuplicateRewriteContext
): LinkFieldOptionsValue => {
  const {
    fkHostTableName: _fkHostTableName,
    selfKeyName: _selfKeyName,
    foreignKeyName: _foreignKeyName,
    ...rest
  } = options;
  const normalizedBaseId = rest.baseId === context.duplicatedBaseId ? undefined : rest.baseId;
  const isInternalSelfLink =
    rest.foreignTableId === context.duplicatedTableId &&
    (normalizedBaseId === undefined || normalizedBaseId === context.duplicatedBaseId);

  if (isInternalSelfLink) {
    return {
      ...rest,
      ...(normalizedBaseId ? { baseId: normalizedBaseId } : {}),
    };
  }

  return {
    ...rest,
    ...(normalizedBaseId ? { baseId: normalizedBaseId } : {}),
    isOneWay: true,
    symmetricFieldId: undefined,
  };
};

const rewriteDuplicatedDto = (
  dto: ITablePersistenceDTO,
  params: DuplicateMethodParams,
  context: DuplicateRewriteContext
): ITablePersistenceDTO => {
  const sanitized: ITablePersistenceDTO = {
    ...dto,
    fields: dto.fields.map(sanitizeFieldPersistenceDto),
  };
  const remapped = deepRemapTableScopedIds(sanitized, context) as ITablePersistenceDTO;

  return {
    ...remapped,
    id: context.duplicatedTableId,
    name: params.newName.toString(),
    dbTableName: undefined,
    primaryFieldId: context.fieldIdMap.get(dto.primaryFieldId) ?? dto.primaryFieldId,
    fields: remapped.fields.map((field) =>
      field.type === 'link'
        ? {
            ...field,
            options: normalizeDuplicatedLinkOptions(field.options, context),
          }
        : field
    ),
  };
};

const ensureDuplicatedLinkDbConfigs = (table: Table): Result<void, DomainError> => {
  return safeTry<void, DomainError>(function* () {
    const hostTableDbTableNameResult = table.dbTableName();
    const hostTableDbTableName = hostTableDbTableNameResult.isOk()
      ? hostTableDbTableNameResult.value
      : undefined;
    const linkFields = table.getFields((field): field is LinkField => field instanceof LinkField);
    const linkFieldById = new Map(
      linkFields.map((field) => [field.id().toString(), field] as const)
    );
    const processedPairs = new Set<string>();

    for (const linkField of linkFields) {
      const symmetricFieldId = linkField.symmetricFieldId();
      const isInternalTwoWaySelfLink =
        !linkField.isOneWay() &&
        linkField.foreignTableId().equals(table.id()) &&
        symmetricFieldId != null;

      if (isInternalTwoWaySelfLink) {
        const pairKey = [linkField.id().toString(), symmetricFieldId!.toString()].sort().join(':');
        if (processedPairs.has(pairKey)) continue;

        const symmetricField = linkFieldById.get(symmetricFieldId!.toString());
        if (symmetricField) {
          yield* linkField.ensureDbConfig({
            baseId: table.baseId(),
            hostTableId: table.id(),
            hostTableDbTableName,
            foreignTableDbTableName: hostTableDbTableName,
          });

          const swappedDbConfig = yield* linkField
            .fkHostTableNameString()
            .andThen((fkHostTableName) =>
              linkField.selfKeyNameString().andThen((selfKeyName) =>
                linkField.foreignKeyNameString().andThen((foreignKeyName) =>
                  LinkFieldConfig.swapDbConfig({
                    fkHostTableName,
                    selfKeyName,
                    foreignKeyName,
                  })
                )
              )
            );

          yield* symmetricField.setDbConfig(swappedDbConfig);
          processedPairs.add(pairKey);
          continue;
        }
      }

      yield* linkField.ensureDbConfig({
        baseId: table.baseId(),
        hostTableId: table.id(),
        hostTableDbTableName,
      });
    }

    return ok(undefined);
  });
};

export function duplicate(
  this: Table,
  params: DuplicateMethodParams
): Result<DuplicateMethodResult, DomainError> {
  const sourceTable = this;
  return safeTry<DuplicateMethodResult, DomainError>(function* () {
    const duplicatedTableId = params.newId ?? (yield* TableId.generate());
    const dto = yield* params.mapper.toDTO(sourceTable);
    const fieldIdMap = new Map<string, string>();
    const viewIdMap = new Map<string, string>();

    for (const field of dto.fields) {
      fieldIdMap.set(field.id, (yield* FieldId.generate()).toString());
    }

    for (const view of dto.views) {
      viewIdMap.set(view.id, (yield* ViewId.generate()).toString());
    }

    const context: DuplicateRewriteContext = {
      sourceTableId: sourceTable.id().toString(),
      duplicatedTableId: duplicatedTableId.toString(),
      duplicatedBaseId: sourceTable.baseId().toString(),
      fieldIdMap,
      viewIdMap,
    };
    const duplicatedDto = rewriteDuplicatedDto(dto, params, context);
    const duplicatedTable = yield* params.mapper.toDomain(duplicatedDto);

    yield* ensureDuplicatedLinkDbConfigs(duplicatedTable);

    duplicatedTable.addDomainEvent(
      TableCreated.create({
        tableId: duplicatedTable.id(),
        baseId: duplicatedTable.baseId(),
        tableName: duplicatedTable.name(),
        fieldIds: duplicatedTable.fieldIds(),
        viewIds: duplicatedTable.viewIds(),
      })
    );

    return ok({
      table: duplicatedTable,
      fieldIdMap,
      viewIdMap,
    });
  });
}
