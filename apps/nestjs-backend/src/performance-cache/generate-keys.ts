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

export function generateBaseNodeListCacheKey(baseId: string) {
  return `base-node-list:${baseId}` as const;
}

export function generateTemplateCacheKeyByBaseId(baseId: string) {
  return `template:base:${baseId}` as const;
}

export function generateTemplateCategoryCacheKey() {
  return `template:category-list` as const;
}

export function generateTemplatePermalinkCacheKey(identifier: string) {
  return `template:permalink:${identifier}` as const;
}

export function generateInstanceBillableUserCountCacheKey() {
  return 'instance-billable-count' as const;
}
