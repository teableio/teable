import type { IFieldRo } from '@teable/core';
import { ColorUtils } from '@teable/core';
import { Badge } from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

import { useEffect, useRef, useState } from 'react';
import { useGraph } from './useGraph';
import { usePlan } from './usePlan';

dayjs.extend(duration);
dayjs.extend(relativeTime);

function formatDuration(milliseconds: number) {
  return dayjs().to(dayjs().add(milliseconds, 'millisecond'));
}

export const FieldGraph = (params: { tableId: string; fieldId?: string; fieldRo?: IFieldRo }) => {
  const ref = useRef(null);
  const planData = usePlan(params);
  const updateCellCount = planData?.updateCellCount;
  const estimateTime = planData?.estimateTime || 0;
  const isCreate = !params.fieldId && params.fieldRo;

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
        <Badge>{Intl.NumberFormat().format(updateCellCount || 0)}</Badge> cells and It should be
        done <b>{formatDuration(estimateTime)}</b>
      </div>
      <div className="relative flex h-[calc(100vh-400px)] max-h-[600px] w-full flex-col">
        <div ref={ref} className="grow rounded border shadow"></div>
      </div>
    </div>
  );
};
