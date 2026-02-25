import {
  FieldUpdated,
  type IDomainEvent,
  type FieldUpdatedValueChange,
  type UpdateFieldResult,
  type IUpdateFieldCommandInput,
  type DomainError,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainEventDtoSchema, mapDomainEventToDto } from '../shared/domainEvent';
import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export type IUpdateFieldRequestDto = IUpdateFieldCommandInput;

export interface IUpdateFieldResponseDataDto {
  table: ITableDto;
  events: Array<IUpdateFieldEventDto>;
}

export type IUpdateFieldResponseDto = IApiResponseDto<IUpdateFieldResponseDataDto>;

export type IUpdateFieldOkResponseDto = IApiOkResponseDto<IUpdateFieldResponseDataDto>;
export type IUpdateFieldErrorResponseDto = IApiErrorResponseDto;

export type IUpdateFieldEndpointResult =
  | { status: 200; body: IUpdateFieldOkResponseDto }
  | { status: HttpErrorStatus; body: IUpdateFieldErrorResponseDto };

export const updateFieldEventDtoSchema = domainEventDtoSchema.extend({
  fieldId: z.string().optional(),
  updatedProperties: z.array(z.string()).optional(),
  changes: z
    .record(
      z.string(),
      z.object({
        oldValue: z.unknown(),
        newValue: z.unknown(),
      })
    )
    .optional(),
});

export type IUpdateFieldEventDto = z.infer<typeof updateFieldEventDtoSchema>;

export const updateFieldResponseDataSchema = z.object({
  table: tableDtoSchema,
  events: z.array(updateFieldEventDtoSchema),
});

export const updateFieldOkResponseSchema = apiOkResponseDtoSchema(updateFieldResponseDataSchema);

export const updateFieldErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapUpdateFieldResultToDto = (
  result: UpdateFieldResult
): Result<IUpdateFieldResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    events: result.events.map(mapUpdateFieldEventToDto),
  }));
};

const mapUpdateFieldEventToDto = (event: IDomainEvent): IUpdateFieldEventDto => {
  const base = mapDomainEventToDto(event);
  const withFieldId = hasFieldId(event) ? { ...base, fieldId: event.fieldId.toString() } : base;

  if (event instanceof FieldUpdated) {
    const changes = mapFieldUpdatedChanges(event.changes);
    return {
      ...withFieldId,
      updatedProperties: [...event.updatedProperties],
      changes: Object.keys(changes).length > 0 ? changes : undefined,
    };
  }

  return withFieldId;
};

const hasFieldId = (
  event: IDomainEvent
): event is IDomainEvent & { fieldId: { toString(): string } } => {
  if (!(event instanceof Object) || !('fieldId' in event)) {
    return false;
  }

  const fieldId = (event as { fieldId?: unknown }).fieldId;
  return fieldId instanceof Object && 'toString' in fieldId;
};

const mapFieldUpdatedChanges = (
  changes: Readonly<Record<string, FieldUpdatedValueChange>>
): Record<string, { oldValue: unknown; newValue: unknown }> => {
  const mapped: Record<string, { oldValue: unknown; newValue: unknown }> = {};

  for (const [property, value] of Object.entries(changes)) {
    mapped[property] = {
      oldValue: serializeChangeValue(value.oldValue),
      newValue: serializeChangeValue(value.newValue),
    };
  }

  return mapped;
};

const serializeChangeValue = (value: unknown): unknown => {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeChangeValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Object) {
    const dtoResult = callObjectMethod(value, 'toDto');
    if (dtoResult !== undefined) {
      return unwrapResultLike(dtoResult);
    }

    const valueResult = callObjectMethod(value, 'value');
    if (valueResult !== undefined) {
      return unwrapResultLike(valueResult);
    }

    if (
      'toString' in value &&
      typeof value.toString === 'function' &&
      value.constructor?.name !== 'Object'
    ) {
      return value.toString();
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serializeChangeValue(nested)])
    );
  }

  return value;
};

const callObjectMethod = (target: object, methodName: string): unknown => {
  const method = (target as Record<string, unknown>)[methodName];
  if (typeof method !== 'function') {
    return undefined;
  }
  return (method as () => unknown).call(target);
};

const isResultLike = (value: unknown): value is { isOk: () => boolean; value: unknown } => {
  return (
    value instanceof Object &&
    'isOk' in value &&
    typeof (value as { isOk?: unknown }).isOk === 'function' &&
    'value' in value
  );
};

const unwrapResultLike = (value: unknown): unknown => {
  if (isResultLike(value)) {
    return value.isOk() ? serializeChangeValue(value.value) : undefined;
  }
  return serializeChangeValue(value);
};
