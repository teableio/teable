import { generateHash } from './utils';

export function generateRecordCacheKey(
  path: string,
  tableId: string,
  version: string,
  query: unknown
) {
  return `record:${path}:${tableId}:${version}:${generateHash(query)}` as const;
}

export function generateAggCacheKey(
  path: string,
  tableId: string,
  version: string,
  query: unknown
) {
  return `agg:${path}:${tableId}:${version}:${generateHash(query)}` as const;
}

export function generateServiceCacheKey(className: string, methodName: string, args: unknown) {
  return `service:${className}:${methodName}:${generateHash(args)}` as const;
}
