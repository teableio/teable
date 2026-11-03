import { useQuery } from '@tanstack/react-query';
import { duplicateTableCheck } from '@teable/openapi';
import type { IDuplicateTableRo } from '@teable/openapi';
import { useBase } from '@teable/sdk/hooks';
import { useOperationPreview } from '@/features/app/components/operation-preview';
import { useEnv } from '@/features/app/hooks/useEnv';

/** Match the existing write's rollout decision; the v2 endpoint never previews a v1 conversion. */
export const useTableDuplicatePreview = (
  baseId: string,
  tableId: string,
  input: IDuplicateTableRo,
  enabled: boolean
) => {
  const base = useBase();
  const { forceV2All } = useEnv();
  const useV2 = Boolean(forceV2All || (base.v2Status?.useV2 ?? base.isCanary));
  const preview = useOperationPreview(
    {
      operation: 'table.duplicate',
      input: { baseId, tableId, ...input },
      options: { detail: 'full' },
    },
    enabled && useV2
  );
  const legacyCheck = useQuery({
    queryKey: ['duplicate-table-check', baseId, tableId],
    queryFn: () => duplicateTableCheck(baseId, tableId).then((response) => response.data),
    enabled: enabled && !useV2,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    meta: { preventGlobalError: true },
  });
  return {
    useV2,
    preview,
    affectedFields: useV2 ? undefined : legacyCheck.data?.affectedFields,
    // Conversion consequences must be confirmed from a successful check; request failures fail closed.
    canConfirm: enabled && (useV2 ? preview.canConfirm : legacyCheck.isSuccess),
  };
};
