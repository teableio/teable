import type { GraphData, Graph as IGraph } from '@antv/g6';
import { getRandomColorFromStr } from '@teable-group/core';
import { TableApi, useTableId, useViewId } from '@teable-group/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from 'react-query';
import { Rnd } from 'react-rnd';
import { useGridViewStore } from '../view/grid/store/gridView';

export const Graph: React.FC = () => {
  const { selection } = useGridViewStore();
  const { mutateAsync: getGraph } = useMutation({ mutationFn: TableApi.getGraph });
  const tableId = useTableId();
  const viewId = useViewId();
  const graphRef = useRef<IGraph>();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [height, setHeight] = useState(500);
  const [tables, setTables] = useState<{ name: string; color: string }[]>([]);
  useEffect(() => {
    if (!ref.current) {
      return;
    }
    let destroyed = false;
    const element = ref.current;
    import('@antv/g6').then((G6) => {
      if (destroyed) {
        return;
      }
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
    });
    return () => {
      graphRef.current?.destroy();
      destroyed = true;
    };
  }, []);

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
    if (!cell || !isCell || !tableId || !viewId) {
      return;
    }
    getGraph({ tableId, viewId, cell: cell }).then((res) => {
      if (res.data) {
        const { nodes, edges, combos } = res.data;
        const cache: Record<string, string> = {};
        updateGraph({
          nodes: nodes.map((node) => {
            const comboId = node.comboId || 'default';
            const stroke = cache[comboId] ? cache[comboId] : getRandomColorFromStr(comboId);
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
  }, [getGraph, selection, tableId, updateGraph, viewId]);

  return (
    <Rnd
      className="absolute top-20 right-10  bg-background rounded shadow border"
      default={{
        x: window.innerWidth - width,
        y: 0,
        width,
        height,
      }}
      size={{ width, height }}
      onResizeStop={(e, direction, ref) => {
        setWidth(ref.clientWidth);
        setHeight(ref.clientHeight);
      }}
    >
      {!selection && 'Click a cell and see what happens.'}
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
