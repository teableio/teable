import type { INotifyVo } from '@teable/openapi';
import { useMemo, useState } from 'react';

export type IUploadedCover = INotifyVo & { id: string; name: string };

/** What the author has typed or uploaded on the publish page and not yet published. */
export interface IPublishDraft {
  title?: string;
  description?: string;
  changelog?: string;
  cover?: IUploadedCover;
}

const keyOf = (baseId: string) => `teable:publish-draft:${baseId}`;

/**
 * Kept in this browser only, one per project, until the next publish goes through: a reload, a
 * closed tab or a failed publish leaves it where it was. Storage that is full or blocked just
 * means no draft.
 */
export const readPublishDraft = (baseId: string): IPublishDraft => {
  try {
    const raw = window.localStorage.getItem(keyOf(baseId));
    return raw ? (JSON.parse(raw) as IPublishDraft) : {};
  } catch {
    return {};
  }
};

export const patchPublishDraft = (baseId: string, patch: IPublishDraft) => {
  try {
    window.localStorage.setItem(
      keyOf(baseId),
      JSON.stringify({ ...readPublishDraft(baseId), ...patch })
    );
  } catch {
    // no draft then
  }
};

export const clearPublishDraft = (baseId: string) => {
  try {
    window.localStorage.removeItem(keyOf(baseId));
  } catch {
    // nothing kept
  }
};

/**
 * The publish page's draft: the fields it starts from (what is kept, else the defaults), and the
 * way to keep, read and drop it. Off, it keeps nothing and starts from the defaults.
 */
export const usePublishDraft = (enabled: boolean, baseId: string, defaultTitle: string) => {
  const [initial] = useState(() => {
    const kept = enabled ? readPublishDraft(baseId) : {};
    return {
      title: kept.title ?? defaultTitle,
      description: kept.description ?? '',
      changelog: kept.changelog ?? '',
      cover: kept.cover ?? null,
    };
  });
  return useMemo(
    () => ({
      initial,
      read: (): IPublishDraft => (enabled ? readPublishDraft(baseId) : {}),
      keep: (patch: IPublishDraft) => {
        if (enabled) patchPublishDraft(baseId, patch);
      },
      clear: () => clearPublishDraft(baseId),
    }),
    [initial, enabled, baseId]
  );
};
