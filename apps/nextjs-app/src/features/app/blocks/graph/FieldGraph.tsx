import { useQuery } from '@tanstack/react-query';
import type { IFieldRo } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import { planField, planFieldCreate, planFieldUpdate } from '@teable-group/openapi';
import { ReactQueryKeys } from '@teable-group/sdk';
import { useEffect, useRef, useState } from 'react';
import { useGraph } from './useGraph';

export const FieldGraph: React.FC<{ tableId: string; fieldId?: string; fieldRo?: IFieldRo }> = ({
  tableId,
  fieldId,
  fieldRo,
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

  useEffect(() => {
    if (fieldId && fieldRo) {
      planUpdate();
    }

    if (fieldId && !fieldRo) {
      planStatic();
    }

    if (!fieldId && fieldRo) {
      planCreate();
    }
  }, [fieldId, fieldRo, planCreate, planStatic, planUpdate]);

  const ref = useRef(null);

  const [tables, setTables] = useState<{ name: string; color: string }[]>([]);

  const { updateGraph } = useGraph(ref);

  useEffect(() => {
    const graph =
      createPlan?.data?.graph ||
      staticPlan?.data.graph ||
      (updatePlan && !updatePlan.data.skip && updatePlan.data.graph);

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
  }, [createPlan, updatePlan, staticPlan, updateGraph]);

  return (
    <>
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
      <div className="relative flex h-[600px] w-full flex-col">
        <div ref={ref} className="grow rounded border shadow"></div>
      </div>
    </>
  );
};
