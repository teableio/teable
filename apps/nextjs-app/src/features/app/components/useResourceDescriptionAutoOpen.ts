import { LocalStorageKeys } from '@teable/sdk/config';
import { useIsTemplate } from '@teable/sdk/hooks';
import { useCallback, useEffect, useRef, useState } from 'react';

interface IUseResourceDescriptionAutoOpenProps {
  resourceId?: string;
  description?: string | null;
}

const getDescriptionFingerprint = (description: string) => {
  let h1 = 0xdeadbeef ^ description.length;
  let h2 = 0x41c6ce57 ^ description.length;

  for (let i = 0; i < description.length; i++) {
    const ch = description.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
};

const normalizeDescription = (description?: string | null) => {
  const trimmed = description?.trim();
  return trimmed || null;
};

const getDescriptionSeenStorageKey = (resourceId: string) => {
  return `${LocalStorageKeys.BaseNodeDescriptionSeen}:${resourceId}`;
};

const readDescriptionSeen = (resourceId: string) => {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(getDescriptionSeenStorageKey(resourceId));
  } catch {
    return null;
  }
};

const writeDescriptionSeen = (resourceId: string, description?: string | null) => {
  if (typeof window === 'undefined') return;

  try {
    const normalizedDescription = normalizeDescription(description);
    const storageKey = getDescriptionSeenStorageKey(resourceId);

    if (normalizedDescription) {
      window.localStorage.setItem(storageKey, getDescriptionFingerprint(normalizedDescription));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    return;
  }
};

export const useResourceDescriptionAutoOpen = ({
  resourceId,
  description,
}: IUseResourceDescriptionAutoOpenProps) => {
  const isTemplate = useIsTemplate();
  const evaluatedResourceIdRef = useRef<string>();
  const [autoOpenKey, setAutoOpenKey] = useState<string>();

  useEffect(() => {
    if (!resourceId || evaluatedResourceIdRef.current === resourceId) return;

    evaluatedResourceIdRef.current = resourceId;
    setAutoOpenKey(undefined);

    if (isTemplate) return;

    const normalizedDescription = normalizeDescription(description);
    if (!normalizedDescription) {
      writeDescriptionSeen(resourceId, null);
      return;
    }

    const fingerprint = getDescriptionFingerprint(normalizedDescription);
    const seenFingerprint = readDescriptionSeen(resourceId);
    if (seenFingerprint === fingerprint) return;

    writeDescriptionSeen(resourceId, normalizedDescription);
    setAutoOpenKey(`${resourceId}:${fingerprint}`);
  }, [description, isTemplate, resourceId]);

  const markDescriptionSeen = useCallback(
    (nextDescription: string | null) => {
      if (!resourceId || isTemplate) return;
      writeDescriptionSeen(resourceId, nextDescription);
    },
    [isTemplate, resourceId]
  );

  return { autoOpenKey, markDescriptionSeen };
};
