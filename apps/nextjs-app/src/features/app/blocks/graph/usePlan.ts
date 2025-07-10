import { useQuery } from '@tanstack/react-query';
import type { FieldAction, IFieldRo } from '@teable/core';
import { planField, planFieldCreate, planFieldConvert, planFieldDelete } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export function usePlan({
  tableId,
  fieldId,
  fieldRo,
  fieldAction,
}: {
  tableId: string;
  fieldId?: string;
  fieldRo?: IFieldRo;
  fieldAction?: FieldAction;
}) {
  // if fieldAction is not provided, we need to infer it from fieldId and fieldRo
  let action = fieldAction;
  if (!action && fieldId && fieldRo) {
    action = 'field|update';
  }
  if (!action && !fieldId && fieldRo) {
    action = 'field|create';
  }
  if (!action && fieldId && !fieldRo) {
    action = 'field|read';
  }

  const { data: deletePlan } = useQuery({
    queryKey: ReactQueryKeys.planFieldDelete(tableId, fieldId as string),
    queryFn: ({ queryKey }) => planFieldDelete(queryKey[1], queryKey[2]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: action === 'field|delete',
  });

  const { data: updatePlan } = useQuery({
    queryKey: ReactQueryKeys.planFieldConvert(tableId, fieldId as string, fieldRo as IFieldRo),
    queryFn: ({ queryKey }) =>
      planFieldConvert(queryKey[1], queryKey[2], queryKey[3]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: action === 'field|update',
  });

  const { data: createPlan } = useQuery({
    queryKey: ReactQueryKeys.planFieldCreate(tableId, fieldRo as IFieldRo),
    queryFn: ({ queryKey }) => planFieldCreate(queryKey[1], queryKey[2]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: action === 'field|create',
  });

  const { data: staticPlan } = useQuery({
    queryKey: ReactQueryKeys.planField(tableId, fieldId as string),
    queryFn: ({ queryKey }) => planField(queryKey[1], queryKey[2]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: action === 'field|read',
  });

  return deletePlan || updatePlan || createPlan || staticPlan;
}
