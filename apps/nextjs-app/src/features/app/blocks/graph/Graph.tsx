import type { GraphData, Graph as IGraph } from '@antv/g6';
import G6 from '@antv/g6';
import { useMutation } from '@tanstack/react-query';
import { ColorUtils } from '@teable-group/core';
import { X } from '@teable-group/icons';
import { getGraph } from '@teable-group/openapi';
import { useBase, useTableId, useViewId } from '@teable-group/sdk';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { useMount } from 'react-use';
import { useGridViewStore } from '../view/grid/store/gridView';
import { useGraphStore } from './useGraphStore';

export const Graph: React.FC = () => {
  const { selection } = useGridViewStore();
  const { mutateAsync: getGraphMutator } = useMutation({ mutationFn: getGraph });
  const tableId = useTableId();
  const base = useBase();
  const viewId = useViewId();
  const graphRef = useRef<IGraph>();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [height, setHeight] = useState(500);
  const [x, setX] = useState(0);
  const [y, setY] = useState(30);
  const [tables, setTables] = useState<{ name: string; color: string }[]>([]);
  const { closeGraph } = useGraphStore();

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const element = ref.current;
    const graph = new G6.Graph({
      container: element,
      width: element.clientWidth,
      height: element.clientHeight,
      fitViewPadding: 20,
      fitView: true,
      fitCenter: true,
      autoPaint: true,
      layout: {
        type: 'dagre',
        nodesep: 20,
        ranksep: 40,
        align: 'UL',
      },
      defaultEdge: {
        labelCfg: {
          autoRotate: true,
        },
        style: {
          endArrow: {
            path: G6.Arrow.triangle(5, 5, 5),
            d: 5,
          },
        },
      },
      defaultNode: {
        type: 'ellipse',
      },
      modes: {
        default: ['drag-node'],
      },
      animate: true,
    });
    graphRef.current = graph;
    return () => {
      graphRef.current?.destroy();
    };
  }, []);

  useMount(() => {
    const x =
      ((ref.current?.offsetParent as HTMLElement | undefined)?.offsetParent?.clientWidth || 0) -
      width;
    setX(x);
  });

  const updateGraph = useCallback(async (data?: GraphData) => {
    const graph = graphRef.current;
    if (!graph) {
      return;
    }
    if (data) {
      graph.data(data);
    } else {
      graph.data({ nodes: [], edges: [] });
    }
    graph.render();
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (graph == undefined) {
      return;
    }
    graph.changeSize(width, height);
    graph.render();
  }, [height, width]);

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
                lineWidth: node.isSelected ? 3 : 1,
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
      className="absolute top-20 right-10  bg-background rounded shadow border"
      size={{ width, height }}
      position={{ x, y }}
      onDragStop={(e, d) => {
        setX(d.x);
        setY(d.y);
      }}
      onResizeStop={(e, direction, ref) => {
        setWidth(ref.clientWidth);
        setHeight(ref.clientHeight);
      }}
    >
      {!selection && 'Click a cell and see what happens.'}
      <Button
        variant={'ghost'}
        size="xs"
        className="absolute top-2 right-2"
        onClick={() => closeGraph()}
      >
        <X className="w-4 h-4" />
      </Button>
      <div className="absolute top-0 left-0 p-2 flex text-xs gap-2">
        {tables.map((table) => {
          return (
            <div key={table.color} className="flex gap-1 justify-center items-center">
              <span>{table.name}</span>
              <span className="h-2 w-2" style={{ backgroundColor: table.color }}></span>
            </div>
          );
        })}
      </div>
      <div ref={ref} className="w-full h-full"></div>
    </Rnd>
  );
};

export type IGraphComponent = typeof Graph;
