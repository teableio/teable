import type { FieldAction, IFieldRo } from '@teable/core';
import { ColorUtils } from '@teable/core';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Badge } from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { useGraph } from './useGraph';
import { usePlan } from './usePlan';

dayjs.extend(duration);
dayjs.extend(relativeTime);

export const FieldGraph = (params: {
  tableId: string;
  fieldId?: string;
  fieldRo?: IFieldRo;
  fieldAction?: FieldAction;
}) => {
  const ref = useRef(null);
  const planData = usePlan(params);
  const updateCellCount = planData?.updateCellCount;
  const linkFieldCount = planData?.linkFieldCount;
  const estimateTime = planData?.estimateTime || 0;
  const { t, i18n } = useTranslation(['table']);
  const dayjs = useLanDayjs();

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

  const formatDuration = dayjs(Date.now() + estimateTime).fromNow();

  return (
    <div className="flex flex-col gap-2 pb-2">
      <div className="flex flex-wrap items-center gap-2 pb-2 text-sm">
        {t('table.graph.tableLabel')}
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
      <div className="flex items-center gap-2 text-xs">
        <div>
          {t('table.graph.effectCells')}:{' '}
          <Badge>{Intl.NumberFormat(i18n.language).format(updateCellCount || 0)}</Badge>
        </div>
        <div>
          {t('table.graph.estimatedTime')}: <b>{formatDuration}</b>
        </div>
      </div>
      {linkFieldCount && linkFieldCount > 0 ? (
        <div className="flex items-center gap-2 text-xs">
          {t('table.graph.linkFieldCount')}:{' '}
          <Badge>{Intl.NumberFormat(i18n.language).format(linkFieldCount)}</Badge>
        </div>
      ) : null}

      <div className="relative flex h-[calc(100vh-400px)] max-h-[600px] w-full flex-col">
        <div ref={ref} className="grow rounded border shadow"></div>
      </div>
    </div>
  );
};
