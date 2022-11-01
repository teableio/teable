import { isPlainObject } from '@teable-group/ts-utils';
import type {
  JsonApiErrorResponse,
  JsonApiResponse,
  JsonApiSuccessResponse,
} from './json-api-response.types';

export const isJsonApiResponse = <T = unknown>(
  val: unknown
): val is JsonApiResponse<T> => {
  return isPlainObject(val) && typeof val?.success === 'boolean';
};

export const isJsonApiSuccessResponse = <T = unknown>(
  val: unknown
): val is JsonApiSuccessResponse<T> => {
  return isJsonApiResponse<T>(val) && val.success && 'data' in val;
};

export const isJsonApiErrorResponse = (
  val: unknown
): val is JsonApiErrorResponse => {
  return (
    isJsonApiResponse<unknown>(val) &&
    !val.success &&
    'errors' in val &&
    Array.isArray(val.errors)
  );
};
