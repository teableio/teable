import { isPlainObject } from '../typeguards';
import type {
  IJsonApiErrorResponse,
  IJsonApiResponse,
  IJsonApiSuccessResponse,
} from './json-api-response.types';

export const isJsonApiResponse = <T = unknown>(val: unknown): val is IJsonApiResponse<T> => {
  return isPlainObject(val) && typeof val?.success === 'boolean';
};

export const isJsonApiSuccessResponse = <T = unknown>(
  val: unknown
): val is IJsonApiSuccessResponse<T> => {
  return isJsonApiResponse<T>(val) && val.success && 'data' in val;
};

export const isJsonApiErrorResponse = (val: unknown): val is IJsonApiErrorResponse => {
  return (
    isJsonApiResponse<unknown>(val) && !val.success && 'errors' in val && Array.isArray(val.errors)
  );
};
