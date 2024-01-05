import { useQuery } from '@tanstack/react-query';
import type { IFieldRo } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import { planField, planFieldCreate, planFieldUpdate } from '@teable-group/openapi';
import { ReactQueryKeys } from '@teable-group/sdk';
import { Badge } from '@teable-group/ui-lib/shadcn';
import { useEffect, useRef, useState } from 'react';
import { useGraph } from './useGraph';

export const FieldGraph = ({
  tableId,
  fieldId,
  fieldRo,
}: {
  tableId: string;
  fieldId?: string;
  fieldRo?: IFieldRo;
}) => {
  const { data: updatePlan, refetch: planUpdate } = useQuery({
    queryKey: ReactQueryKeys.planFieldUpdate(tableId, fieldId as string, fieldRo as IFieldRo),
    queryFn: ({ queryKey }) => planFieldUpdate(queryKey[1], queryKey[2], queryKey[3]),
    refetchOnWindowFocus: false,
    enabled: false,
  });

  const { data: createPlan, refetch: planCreate } = useQuery({
    queryKey: ReactQueryKeys.planFieldCreate(tableId, fieldRo as IFieldRo),
    queryFn: ({ queryKey }) => planFieldCreate(queryKey[1], queryKey[2]),
    refetchOnWindowFocus: false,
    enabled: false,
  });

  const { data: staticPlan, refetch: planStatic } = useQuery({
    queryKey: ReactQueryKeys.planField(tableId, fieldId as string),
    queryFn: ({ queryKey }) => planField(queryKey[1], queryKey[2]),
    refetchOnWindowFocus: false,
    enabled: false,
  });

  const isUpdate = fieldId && fieldRo;
  const isStatic = fieldId && !fieldRo;
  const isCreate = !fieldId && fieldRo;
  const planData = createPlan?.data || staticPlan?.data || updatePlan?.data;
  const isAsync = planData?.isAsync;
  const updateCellCount = planData?.updateCellCount;

  useEffect(() => {
    if (isUpdate) {
      planUpdate();
    }

    if (isCreate) {
      planCreate();
    }

    if (isStatic) {
      planStatic();
    }
  }, [isCreate, isStatic, isUpdate, planCreate, planStatic, planUpdate]);

  const ref = useRef(null);

  const [tables, setTables] = useState<{ name: string; color: string }[]>([]);

  const { updateGraph } = useGraph(ref);

  useEffect(() => {
    const graph = planData?.graph;

    if (!graph) {
      return;
    }

    const { nodes, edges, combos } = graph;
    const cache: Record<string, string> = {};
    updateGraph({
      nodes: nodes?.map((node) => {
        const comboId = node.comboId || 'default';
        const color = cache[comboId] ? cache[comboId] : ColorUtils.getRandomColorFromStr(comboId);
        cache[comboId] = color;
        const stroke = ColorUtils.getHexForColor(color);
        return {
          ...node,
          label: `${node.label}`,
          style: {
            stroke,
            lineWidth: node.isSelected ? 5 : 1,
            lineDash: node.isSelected ? [6, 4] : undefined,
            fill: stroke,
          },
        };
      }),
      edges,
    });
    setTables(
      combos?.map((combo) => ({
        name: combo.label,
        color: ColorUtils.getHexForColor(cache[combo.id]) || '',
      }))
    );
  }, [planData, updateGraph]);

  return (
    <div className="flex flex-col gap-2 pb-2">
      <div className="flex items-center gap-2 pb-2 text-xs">
        Table label:
        {tables.map((table) => {
          return (
            <div
              key={table.color}
              className="flex items-center justify-center gap-1 rounded border px-1 py-[2px]"
              style={{
                borderColor: table.color,
                backgroundColor: table.color + '80',
              }}
            >
              <span>{table.name}</span>
            </div>
          );
        })}
      </div>
      <div className="text-sm">
        {isCreate ? 'Creating' : 'Modifying'} this field may affect{' '}
        <Badge>{updateCellCount || 0}</Badge> cells and the update will be{' '}
        {isAsync ? 'asynchronously processed' : 'completed immediately'}.
      </div>
      <div className="relative flex h-[calc(100vh-400px)] max-h-[600px] w-full flex-col">
        <div ref={ref} className="grow rounded border shadow"></div>
      </div>
    </div>
  );
};
