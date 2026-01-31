import { useQuery } from '@tanstack/react-query';
import type { ILookupLinkOptionsVo } from '@teable/core';
import { FieldType } from '@teable/core';
import { planFieldDelete } from '@teable/openapi';
import type { IFieldInstance } from '@teable/sdk/model';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AffectedField, PlanData } from './types';

/**
 * Extract affected field info from plan data based on edge direction.
 * Only fields that depend on the deleted field (target of edges where deleted field is source) are affected.
 */
const getAffectedFields = (planData: PlanData | undefined): AffectedField[] => {
  if (!planData?.data?.graph) return [];

  const { nodes, combos, edges } = planData.data.graph;
  if (!nodes || !edges) return [];

  const comboMap = new Map<string, string>();
  combos?.forEach((combo) => comboMap.set(combo.id, combo.label));

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const deletedFieldIds = new Set(nodes.filter((n) => n.isSelected).map((n) => n.id));

  const affectedFields: AffectedField[] = [];

  // Find affected fields: targets of edges where source is a deleted field
  edges.forEach((edge) => {
    if (!deletedFieldIds.has(edge.source)) return;

    const targetNode = nodeMap.get(edge.target);
    if (!targetNode || targetNode.isSelected) return;

    // Avoid duplicates
    if (affectedFields.some((f) => f.id === edge.target)) return;

    affectedFields.push({
      id: edge.target,
      name: targetNode.label || edge.target,
      type: targetNode.fieldType as FieldType,
      tableName: targetNode.comboId ? comboMap.get(targetNode.comboId) : undefined,
    });
  });

  return affectedFields;
};

const getAffectedLookupFields = (
  tableName: string,
  fieldId: string,
  fieldInstances: IFieldInstance[]
): AffectedField[] => {
  const field = fieldInstances.find((f) => f.id === fieldId);
  if (!field || field.type !== FieldType.Link) return [];
  const lookupFields = fieldInstances.filter(
    (f) => f.isLookup && (f.lookupOptions as ILookupLinkOptionsVo)?.linkFieldId === fieldId
  );
  return lookupFields.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    tableName: tableName,
  }));
};

/**
 * Hook for single field delete plan analysis with lazy loading
 */
export const useSingleFieldPlan = (
  tableId: string,
  fieldId: string | null,
  enabled: boolean,
  fieldInstances: IFieldInstance[]
) => {
  const { data: planData, isLoading } = useQuery({
    queryKey: ['get-delete-field-plan', tableId, fieldId],
    queryFn: async () => {
      if (!fieldId) return null;
      const res = await planFieldDelete(tableId, fieldId);
      return { fieldId, data: res.data } as PlanData;
    },
    enabled: enabled && !!fieldId,
    refetchOnWindowFocus: false,
  });

  const affectedFields = useMemo(() => getAffectedFields(planData ?? undefined), [planData]);
  const tableName = planData?.data?.graph?.combos?.find((c) => c.id === tableId)?.label;
  const lookupFields = useMemo(() => {
    if (!tableName) return [];
    if (!fieldId) return [];
    return getAffectedLookupFields(tableName, fieldId, fieldInstances);
  }, [tableName, fieldId, fieldInstances]);
  const allAffectedFields = useMemo(
    () => [...affectedFields, ...lookupFields],
    [affectedFields, lookupFields]
  );
  return { affectedFields: allAffectedFields, isLoading, isLoaded: !!planData };
};

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

  // Reset state when fieldIds change
  const fieldIdsKey = fieldIds.join(',');
  useEffect(() => {
    setSelectedFieldId(fieldIds[0] ?? null);
    setViewedFieldIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
