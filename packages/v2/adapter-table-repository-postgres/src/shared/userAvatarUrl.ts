import {
  buildUserAvatarUrl,
  ConditionalLookupField,
  type Field,
  LookupField,
} from '@teable/v2-core';

export { buildUserAvatarUrl, resolveUserAvatarUrlPrefix } from '@teable/v2-core';

export const isUserCellField = (field: Field): boolean => {
  if (field instanceof LookupField || field instanceof ConditionalLookupField) {
    const inner = field.innerField();
    return inner.isOk() && isUserCellField(inner.value);
  }
  switch (field.type().toString()) {
    case 'user':
    case 'createdBy':
    case 'lastModifiedBy':
      return true;
    default:
      return false;
  }
};

export const normalizeStoredUserAvatarUrls = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (!value.includes('"id"')) {
      return value;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      const normalized = normalizeStoredUserAvatarUrls(parsed);
      return normalized === parsed ? value : normalized;
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeStoredUserAvatarUrls(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const item = value as Record<string, unknown>;
  const id = item.id;
  if (typeof id !== 'string' || id.length === 0) {
    return value;
  }

  const avatarUrl = buildUserAvatarUrl(id);
  if (item.avatarUrl === avatarUrl) {
    return value;
  }

  return {
    ...item,
    avatarUrl,
  };
};
