import { useQuery } from '@tanstack/react-query';
import type { IFieldRo } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import { planFieldCreate } from '@teable-group/openapi';
import { ReactQueryKeys } from '@teable-group/sdk';
import { useEffect, useRef, useState } from 'react';
import { useGraph } from './useGraph';

export const FieldGraph: React.FC<{ tableId: string; fieldRo: IFieldRo }> = ({
  tableId,
  fieldRo,
}) => {
  const { data: plan } = useQuery({
    queryKey: ReactQueryKeys.planFieldCreate(tableId, fieldRo),
    queryFn: ({ queryKey }) => planFieldCreate(queryKey[1], queryKey[2]),
    refetchOnWindowFocus: false,
  });
  const ref = useRef(null);

  const [tables, setTables] = useState<{ name: string; color: string }[]>([]);

  const { updateGraph } = useGraph(ref);

  useEffect(() => {
    if (!plan?.data?.graph) {
      return;
    }

    const { nodes, edges, combos } = plan.data.graph;
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
  }, [plan?.data?.graph, updateGraph]);

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
      <div className="flex h-[600px] w-full flex-col">
        <div ref={ref} className="grow rounded border shadow"></div>
      </div>
    </>
  );
};
