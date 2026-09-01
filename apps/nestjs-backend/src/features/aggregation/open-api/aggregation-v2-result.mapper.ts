import type { StatisticsFunc } from '@teable/core';
import type { IAggregationVo, IGroupPoint, IGroupPointsVo } from '@teable/openapi';
import { GroupPointType } from '@teable/openapi';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapFieldToDto,
} from '@teable/v2-contract-http';
import { ListFieldsQuery } from '@teable/v2-core';
import type {
  AggregateTableRecordsResult,
  AttachmentValueDecoratorService,
  IQueryBus,
  ListFieldsResult,
} from '@teable/v2-core';
import { convertValueToStringify, string2Hash } from '../../../utils';
import {
  normalizeLegacyRecordFilterForV2,
  type IRecordFilterFieldMeta,
} from '../../record/open-api/record-filter-v2.mapper';
import { throwV2Error } from '../../v2/v2-http-error';

type IV2QueryExecutionContext = Parameters<IQueryBus['execute']>[0];

type GroupPointMappingState = {
  previousValues: unknown[];
  collapsedDepth: number;
};

/** Bridge a v2 domain error into the shared HTTP error shape. */
export function throwV2QueryDomainError(
  error: Parameters<typeof mapDomainErrorToHttpError>[0]
): never {
  throwV2Error(mapDomainErrorToHttpError(error), mapDomainErrorToHttpStatus(error));
}

/**
 * Convert a legacy (v1) record filter into the v2 filter DTO. Field metadata is
 * sourced through the query bus so the caller stays adapter-agnostic.
 */
export async function normalizeLegacyFilterViaQueryBus(
  tableId: string,
  rawFilter: unknown,
  actorId: string,
  queryBus: IQueryBus,
  context: IV2QueryExecutionContext
) {
  if (rawFilter == null) return rawFilter;

  const queryResult = ListFieldsQuery.create({ tableId });
  if (queryResult.isErr()) {
    throwV2QueryDomainError(queryResult.error);
  }
  const fieldsResult = await queryBus.execute<ListFieldsQuery, ListFieldsResult>(
    context,
    queryResult.value
  );
  if (fieldsResult.isErr()) {
    throwV2QueryDomainError(fieldsResult.error);
  }

  const fieldMetaById = new Map<string, IRecordFilterFieldMeta>();
  for (const field of fieldsResult.value.fields) {
    const fieldDto = mapFieldToDto(field, fieldsResult.value.primaryFieldId);
    if (fieldDto.isErr()) {
      throwV2QueryDomainError(fieldDto.error);
    }
    fieldMetaById.set(fieldDto.value.id, {
      type: fieldDto.value.type,
      cellValueType: 'cellValueType' in fieldDto.value ? fieldDto.value.cellValueType : undefined,
      options: fieldDto.value.options,
    });
  }

  const normalized = normalizeLegacyRecordFilterForV2(rawFilter, fieldMetaById, actorId);
  if (normalized.isErr()) {
    throwV2QueryDomainError(normalized.error);
  }
  return normalized.value;
}

/** Map an AggregateTableRecordsResult to the legacy IAggregationVo shape. */
export function mapAggregationResult(
  result: AggregateTableRecordsResult,
  groupBy: ReadonlyArray<{ fieldId: string }> | undefined
): IAggregationVo {
  const aggregations: NonNullable<IAggregationVo['aggregations']> = result.values
    .filter((value) => value.groupValues === undefined)
    .map((value) => ({
      fieldId: value.fieldId.toString(),
      total: { value: value.value, aggFunc: value.statisticFunc as StatisticsFunc },
    }));
  const aggregationByKey = new Map(
    aggregations.map((aggregation) => [
      `${aggregation.fieldId}:${aggregation.total!.aggFunc}`,
      aggregation,
    ])
  );

  for (const value of result.values) {
    if (!value.groupValues?.length) continue;
    const currentGroup = groupBy?.[value.groupValues.length - 1];
    if (!currentGroup) continue;
    const groupValue = value.groupValues.map(convertValueToStringify).join('_');
    const groupId = String(string2Hash(`${currentGroup.fieldId}_${groupValue}`));
    const aggregation = aggregationByKey.get(`${value.fieldId.toString()}:${value.statisticFunc}`);
    if (!aggregation) continue;
    aggregation.group ??= {};
    aggregation.group[groupId] = {
      value: value.value,
      aggFunc: value.statisticFunc as StatisticsFunc,
    };
  }

  return { aggregations };
}

/** Map a grouped count AggregateTableRecordsResult to the legacy group points shape. */
export async function mapGroupPointsResult(
  result: AggregateTableRecordsResult,
  collapsedGroupIds: ReadonlySet<string>,
  attachmentDecorator: AttachmentValueDecoratorService
): Promise<IGroupPointsVo> {
  const depth = result.groupBy.length;
  if (!depth) return [];
  const total =
    Number(
      result.values.find(
        (value) => value.statisticFunc === 'count' && value.groupValues === undefined
      )?.value
    ) || 0;
  const rows = result.values.filter(
    (value) => value.statisticFunc === 'count' && value.groupValues?.length === depth
  );
  const groupPoints: IGroupPoint[] = [];
  const state: GroupPointMappingState = {
    previousValues: Array.from({ length: depth }, () => Symbol()),
    collapsedDepth: Number.MAX_SAFE_INTEGER,
  };
  let groupedRowCount = 0;

  for (const row of rows) {
    await appendGroupHeaders(
      result,
      row.groupValues!,
      collapsedGroupIds,
      attachmentDecorator,
      state,
      groupPoints
    );

    const count = Number(row.value) || 0;
    groupedRowCount += count;
    if (state.collapsedDepth === Number.MAX_SAFE_INTEGER) {
      groupPoints.push({ type: GroupPointType.Row, count });
    }
  }

  if (groupedRowCount < total) {
    groupPoints.push(
      {
        id: 'unknown',
        type: GroupPointType.Header,
        depth: 0,
        value: 'Unknown',
        isCollapsed: false,
      },
      { type: GroupPointType.Row, count: total - groupedRowCount }
    );
  }
  return groupPoints;
}

async function appendGroupHeaders(
  result: AggregateTableRecordsResult,
  rawGroupValues: ReadonlyArray<unknown>,
  collapsedGroupIds: ReadonlySet<string>,
  attachmentDecorator: AttachmentValueDecoratorService,
  state: GroupPointMappingState,
  groupPoints: IGroupPoint[]
): Promise<void> {
  for (let index = 0; index < rawGroupValues.length; index++) {
    const rawValue = rawGroupValues[index];
    const stringifiedValue = convertValueToStringify(rawValue);
    if (state.previousValues[index] === stringifiedValue) continue;

    const group = result.groupBy[index]!;
    const groupId = String(
      string2Hash(
        `${group.fieldId.toString()}_${[
          ...state.previousValues.slice(0, index),
          stringifiedValue,
        ].join('_')}`
      )
    );
    if (index > state.collapsedDepth) break;

    state.collapsedDepth = Number.MAX_SAFE_INTEGER;
    state.previousValues[index] = stringifiedValue;
    state.previousValues = state.previousValues.map((value, valueIndex) =>
      valueIndex > index ? Symbol() : value
    );
    const isCollapsed = collapsedGroupIds.has(groupId);
    const value =
      group.fieldType === 'attachment'
        ? await decorateAttachmentGroupValue(rawValue, attachmentDecorator)
        : rawValue;
    groupPoints.push({
      id: groupId,
      type: GroupPointType.Header,
      depth: index,
      value,
      isCollapsed,
    });
    if (isCollapsed) state.collapsedDepth = index;
  }
}

async function decorateAttachmentGroupValue(
  value: unknown,
  attachmentDecorator: AttachmentValueDecoratorService
): Promise<unknown> {
  const result = await attachmentDecorator.decorateAttachmentValue(value);
  if (result.isErr()) throwV2QueryDomainError(result.error);
  return result.value;
}
