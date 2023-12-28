import { useMutation } from '@tanstack/react-query';
import { ColorUtils } from '@teable-group/core';
import { DraggableHandle, X } from '@teable-group/icons';
import { getGraph } from '@teable-group/openapi';
import { useBase, useTableId, useViewId } from '@teable-group/sdk';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { useMount } from 'react-use';
import { useGridViewStore } from '../view/grid/store/gridView';
import { useGraph } from './useGraph';
import { useGraphStore } from './useGraphStore';

export const Graph: React.FC = () => {
  const { selection } = useGridViewStore();
  const { mutateAsync: getGraphMutator, data, isLoading } = useMutation({ mutationFn: getGraph });
  const tableId = useTableId();
  const base = useBase();
  const viewId = useViewId();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [height, setHeight] = useState(500);
  const [x, setX] = useState(0);
  const [y, setY] = useState(30);
  const [tables, setTables] = useState<{ name: string; color: string }[]>([]);
  const { closeGraph } = useGraphStore();

  useMount(() => {
    const x =
      ((ref.current?.offsetParent as HTMLElement | undefined)?.offsetParent?.clientWidth || 0) -
      width;
    setX(x);
  });

  const { updateGraph } = useGraph(ref, width, height);

  useEffect(() => {
    const cell = selection?.ranges?.[0];
    const isCell = selection?.isCellSelection;
    if (!cell || !isCell || !tableId || !viewId || !base.id) {
      return;
    }
    getGraphMutator({ baseId: base.id, tableId, viewId, cell: cell }).then((res) => {
      if (res.data) {
        const { nodes, edges, combos } = res.data;
        const cache: Record<string, string> = {};
        updateGraph({
          nodes: nodes.map((node) => {
            const comboId = node.comboId || 'default';
            const stroke = cache[comboId]
              ? cache[comboId]
              : ColorUtils.getRandomHexFromStr(comboId);
            cache[comboId] = stroke;
            return {
              ...node,
              label: `${node.fieldName}\n${node.label}`,
              style: {
                stroke,
                lineWidth: node.isSelected ? 5 : 1,
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
  }, [base.id, getGraphMutator, selection, tableId, updateGraph, viewId]);

  return (
    <Rnd
      className="absolute right-10 top-20 rounded border bg-background shadow"
      size={{ width, height }}
      position={{ x, y }}
      disableDragging={true}
      onResizeStop={(e, direction, ref) => {
        setWidth(ref.clientWidth);
        setHeight(ref.clientHeight);
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
        className="absolute right-2 top-2"
        onClick={() => closeGraph()}
      >
        <X className="h-4 w-4" />
      </Button>
      <div className="absolute left-5 top-0 flex gap-2 p-2 text-xs">
        {tables.map((table) => {
          return (
            <div key={table.color} className="flex items-center justify-center gap-1">
              <span>{table.name}</span>
              <span className="h-2 w-2" style={{ backgroundColor: table.color }}></span>
            </div>
          );
        })}
      </div>
      {!data?.data?.nodes?.length && !isLoading && (
        <p className="absolute inset-0 flex items-center justify-center">
          Click a cell and see what happens.
        </p>
      )}
      <div ref={ref} className="h-full w-full"></div>
    </Rnd>
  );
};
