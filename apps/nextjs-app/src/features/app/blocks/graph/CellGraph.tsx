import { useMutation } from '@tanstack/react-query';
import { ColorUtils } from '@teable/core';
import { DraggableHandle, X } from '@teable/icons';
import { IdReturnType, getGraph, getIdsFromRanges } from '@teable/openapi';
import { useBaseId, useGridViewStore, useTableId, useViewId } from '@teable/sdk';
import { Button } from '@teable/ui-lib/shadcn';
import { useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { useMount } from 'react-use';
import { useCellGraphStore } from './useCellGraphStore';
import { useGraph } from './useGraph';

export const CellGraph: React.FC = () => {
  const { selection } = useGridViewStore();
  const { mutateAsync: getGraphMutator, data, isLoading } = useMutation({ mutationFn: getGraph });
  const tableId = useTableId();
  const baseId = useBaseId();
  const viewId = useViewId();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [height, setHeight] = useState(500);
  const [x, setX] = useState(0);
  const [y, setY] = useState(30);
  const [tables, setTables] = useState<{ name: string; color: string }[]>([]);
  const { closeGraph } = useCellGraphStore();

  useMount(() => {
    const x =
      ((ref.current?.offsetParent as HTMLElement | undefined)?.offsetParent?.clientWidth || 0) -
      width;
    setX(x);
  });

  const { updateGraph, changeSize } = useGraph(ref);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  useEffect(() => {
    const cell = selection?.ranges?.[0];
    const isCell = selection?.isCellSelection;
    if (!selection || !cell || !isCell || !tableId || !viewId || !baseId) {
      return;
    }
    getIdsFromRanges(tableId, {
      viewId: viewId,
      ranges: selection.serialize(),
      returnType: IdReturnType.All,
    }).then((res) => {
      const fieldId = res.data?.fieldIds?.[0];
      const recordId = res.data?.recordIds?.[0];
      if (!fieldId || !recordId) {
        return;
      }

      getGraphMutator({ baseId, tableId, cell: [fieldId, recordId] }).then((res) => {
        if (res.data) {
          const { nodes, edges, combos } = res.data;
          const cache: Record<string, string> = {};
          updateGraph({
            nodes: nodes?.map((node) => {
              const comboId = node.comboId || 'default';
              const color = cache[comboId]
                ? cache[comboId]
                : ColorUtils.getRandomColorFromStr(comboId);
              cache[comboId] = color;
              const stroke = ColorUtils.getHexForColor(color);
              return {
                ...node,
                label: `${node.fieldName}\n${node.label || '-'}`,
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
            combos.map((combo) => ({
              name: combo.label,
              color: cache[combo.id] || '',
            }))
          );
        } else {
          updateGraph();
          setTables([]);
        }
      });
    });
  }, [baseId, getGraphMutator, selection, tableId, updateGraph, viewId]);

  return (
    <Rnd
      className="absolute right-10 top-20 rounded border bg-background shadow"
      size={{ width, height }}
      position={{ x, y }}
      disableDragging={true}
      onResizeStop={(e, direction, ref) => {
        setWidth(ref.clientWidth);
        setHeight(ref.clientHeight);
        changeSize();
      }}
    >
      <Rnd
        className="absolute left-2 top-2 z-10"
        default={{
          x: 8,
          y: 8,
          width: 20,
          height: 20,
        }}
        position={{ x: 8, y: 8 }}
        onDrag={(e, d) => {
          setX(x + d.x);
          setY(y + d.y);
        }}
        enableResizing={false}
      >
        <DraggableHandle />
      </Rnd>
      <Button
        variant={'ghost'}
        size="xs"
        className="absolute right-2 top-2 z-10"
        onClick={() => closeGraph()}
      >
        <X className="size-4" />
      </Button>
      <div className="absolute left-5 top-0 flex gap-2 p-2 text-xs">
        {tables.map((table) => {
          return (
            <div key={table.color} className="flex items-center justify-center gap-1">
              <span>{table.name}</span>
              <span className="size-2" style={{ backgroundColor: table.color }}></span>
            </div>
          );
        })}
      </div>
      {!data?.data?.nodes?.length && !isLoading && (
        <p className="absolute inset-0 flex items-center justify-center">
          Click a cell and see what happens.
        </p>
      )}
      <div ref={ref} className="size-full"></div>
    </Rnd>
  );
};
