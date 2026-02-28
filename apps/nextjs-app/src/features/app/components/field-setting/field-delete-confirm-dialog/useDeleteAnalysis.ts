import { useQuery } from '@tanstack/react-query';
import type { IFieldDeleteReferencesItem } from '@teable/openapi';
import { getFieldDeleteReferences } from '@teable/openapi';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AffectedItem } from './types';

export interface FieldViewState {
  selectedFieldId: string | null;
  viewedFieldIds: Set<string>;
}

/**
 * Hook to manage field selection and view state for multi-field delete dialog
 */
export const useFieldSelectionState = (fieldIds: string[]) => {
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [viewedFieldIds, setViewedFieldIds] = useState<Set<string>>(new Set());

  const fieldIdsKey = fieldIds.join(',');
  useEffect(() => {
    setSelectedFieldId(fieldIds[0] ?? null);
    setViewedFieldIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fieldIdsKey is derived from fieldIds
  }, [fieldIdsKey]);

  const markAsViewed = useCallback((fieldId: string) => {
    setViewedFieldIds((prev) => {
      if (prev.has(fieldId)) return prev;
      const next = new Set(prev);
      next.add(fieldId);
      return next;
    });
  }, []);

  const selectField = useCallback((fieldId: string) => {
    setSelectedFieldId(fieldId);
  }, []);

  const unviewedCount = fieldIds.length - viewedFieldIds.size;

  return {
    selectedFieldId,
    viewedFieldIds,
    unviewedCount,
    selectField,
    markAsViewed,
  };
};

/**
 * Hook to manage field check state for multi-field delete dialog
 */
export const useFieldCheckState = (fieldIds: string[], open: boolean) => {
  const [checkedFieldIds, setCheckedFieldIds] = useState<Set<string>>(new Set(fieldIds));

  const fieldIdsKey = fieldIds.join(',');
  useEffect(() => {
    if (open) {
      setCheckedFieldIds(new Set(fieldIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fieldIdsKey is derived from fieldIds
  }, [fieldIdsKey, open]);

  const toggleField = useCallback((fieldId: string) => {
    setCheckedFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) {
        next.delete(fieldId);
      } else {
        next.add(fieldId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setCheckedFieldIds(checked ? new Set(fieldIds) : new Set());
    },
    [fieldIds]
  );

  return {
    checkedFieldIds,
    toggleField,
    toggleAll,
  };
};

const mapItemReferences = (refs: IFieldDeleteReferencesItem): AffectedItem[] => {
  const items: AffectedItem[] = [];

  refs.dependentFields.forEach((f) => {
    items.push({
      id: f.id,
      name: f.name,
      itemType: 'field',
      type: f.type,
      source: f.source,
    });
  });

  refs.views.forEach((v) => {
    items.push({
      id: v.id,
      name: v.name,
      itemType: 'view',
      type: v.type,
      source: v.source,
    });
  });

  refs.workflowNodes.forEach((node) => {
    items.push({
      id: node.id,
      name: node.name ?? node.category,
      itemType: 'workflow',
      type: node.type,
      source: node.source,
    });
  });

  refs.authorityMatrixRoles.forEach((r) => {
    items.push({ id: r.id, name: r.name, itemType: 'authorityMatrix' });
  });

  return items;
};

/**
 * Hook to fetch delete references for one or more fields in a single request.
 * Returns a per-field risk map and overall loading state.
 */
export const useMultiFieldReferences = (tableId: string, fieldIds: string[], enabled: boolean) => {
  const fieldIdsKey = fieldIds.join(',');

  const { data, isLoading } = useQuery({
    queryKey: ['get-field-delete-references', tableId, fieldIdsKey],
    queryFn: async () => {
      const res = await getFieldDeleteReferences(tableId, fieldIds);
      return res.data;
    },
    enabled: enabled && fieldIds.length > 0,
    refetchOnWindowFocus: false,
  });

  const fieldRiskMap = useMemo(() => {
    const map = new Map<string, AffectedItem[]>();
    for (const fieldId of fieldIds) {
      const refs = data?.[fieldId];
      map.set(fieldId, refs ? mapItemReferences(refs) : []);
    }
    return map;
  }, [data, fieldIds]);

  return {
    fieldRiskMap,
    isLoading,
    isAllLoaded: !isLoading,
  };
};
