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

export function generateUserCacheKey(userId: string) {
  return `user:${userId}` as const;
}

export function generateCollaboratorCacheKey(resourceId: string) {
  return `collaborator:${resourceId}` as const;
}

export function generateAccessTokenCacheKey(id: string) {
  return `access-token:${id}` as const;
}

export function generateSettingCacheKey() {
  return `instance:setting` as const;
}

export function generateIntegrationCacheKey(spaceId: string) {
  return `integration:${spaceId}` as const;
}
