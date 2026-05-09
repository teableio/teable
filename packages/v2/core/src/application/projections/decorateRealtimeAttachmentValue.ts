import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { AttachmentValueDecoratorService } from '../services/AttachmentValueDecoratorService';

type PartialAttachmentItem = {
  token?: unknown;
  path?: unknown;
  mimetype?: unknown;
  name?: unknown;
  presignedUrl?: unknown;
  smThumbnailUrl?: unknown;
  lgThumbnailUrl?: unknown;
};

const asAttachmentItems = (value: unknown): ReadonlyArray<PartialAttachmentItem> | null => {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return null;
  if (!value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    return null;
  }
  return value as ReadonlyArray<PartialAttachmentItem>;
};

const isAttachmentLike = (item: PartialAttachmentItem): boolean =>
  typeof item.token === 'string' &&
  typeof item.path === 'string' &&
  typeof item.mimetype === 'string';

const isImageLike = (item: PartialAttachmentItem): boolean =>
  typeof item.mimetype === 'string' && item.mimetype.startsWith('image/');

const renamedTokens = (
  items: ReadonlyArray<PartialAttachmentItem>,
  oldValue: unknown
): Set<string> => {
  const oldItems = asAttachmentItems(oldValue);
  if (!oldItems) return new Set();

  const oldNameByToken = new Map<string, unknown>();
  for (const item of oldItems) {
    if (typeof item.token === 'string') {
      oldNameByToken.set(item.token, item.name);
    }
  }

  const tokens = new Set<string>();
  for (const item of items) {
    if (typeof item.token !== 'string' || !oldNameByToken.has(item.token)) continue;
    if (oldNameByToken.get(item.token) !== item.name) {
      tokens.add(item.token);
    }
  }
  return tokens;
};

const needsDecoration = (value: unknown, oldValue?: unknown): boolean => {
  const items = asAttachmentItems(value);
  if (!items) return false;

  const renamed = renamedTokens(items, oldValue);
  return items.some((item) => {
    if (!isAttachmentLike(item)) return false;
    if (typeof item.token === 'string' && renamed.has(item.token)) return true;
    if (!item.presignedUrl) return true;
    if (isImageLike(item) && (!item.smThumbnailUrl || !item.lgThumbnailUrl)) return true;
    return false;
  });
};

export const decorateRealtimeAttachmentValue = async (
  decorator: AttachmentValueDecoratorService,
  value: unknown,
  oldValue?: unknown
): Promise<Result<unknown, DomainError>> => {
  if (!needsDecoration(value, oldValue)) {
    return ok(value);
  }
  return decorator.decorateAttachmentValue(value, oldValue);
};
