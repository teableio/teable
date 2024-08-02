import type { GraphData, Graph as IGraph } from '@antv/g6';
import G6 from '@antv/g6';
import { useTheme } from '@teable/next-themes';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
export const useGraph = (ref: RefObject<HTMLDivElement>) => {
  const graphRef = useRef<IGraph>();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const element = ref.current;
    const plugins: unknown[] = [
      new G6.ToolBar({
        className:
          'absolute flex gap-2 right-2 bottom-2 border rounded bg-background shadow p-1 pointer cursor-pointer',
      }),
    ];
    if (resolvedTheme === 'light') {
      plugins.push(
        new G6.Grid({
          follow: true,
        })
      );
    }
    const textColor = resolvedTheme === 'light' ? '#000' : '#fff';
    const graph = new G6.Graph({
      plugins,
      container: element,
      width: element.clientWidth,
      height: element.clientHeight,
      fitViewPadding: 20,
      fitView: true,
      fitCenter: true,
      maxZoom: 1,
      autoPaint: true,
      layout: {
        type: 'dagre',
        nodesep: 40,
        ranksep: 30,
        controlPoints: true,
        align: 'UL',
        rankdir: 'BT',
      },
      defaultEdge: {
        type: 'polyline',
        labelCfg: {
          style: {
            fill: textColor,
          },
        },
        style: {
          radius: 20,
          offset: 45,
          endArrow: true,
          lineWidth: 2,
        },
      },
      defaultNode: {
        type: 'rect',
        size: [130, 30],
        anchorPoints: [
          [0.5, 0],
          [0.5, 1],
        ],
        style: {
          fillOpacity: 0.5,
          radius: 10,
        },
      },
      modes: {
        default: [
          {
            type: 'zoom-canvas',
          },
          {
            type: 'drag-canvas',
          },
          'drag-node',
          'brush-select',
        ],
      },
      animate: true,
    });
    graphRef.current = graph;
    return () => {
      try {
        graphRef.current?.destroy();
      } catch (e) {
        console.error(e);
      }
    };
  }, [ref, resolvedTheme]);

  const updateGraph = useCallback(async (data?: GraphData) => {
    const graph = graphRef.current;
    if (!graph) {
      return;
    }
    if (data) {
      graph.data({
        ...data,
        nodes: data.nodes?.map(function (node) {
          return { ...node, label: fittingString(node.label as string, 120) };
        }),
      });
    } else {
      graph.data({ nodes: [], edges: [] });
    }
    graph.render();
  }, []);

  const changeSize = useCallback(() => {
    if (!graphRef.current || !ref.current) {
      return;
    }
    graphRef.current.changeSize(ref.current.clientWidth, ref.current?.clientHeight);
    graphRef.current.render();
  }, [ref]);

  return { updateGraph, changeSize };
};

const fittingString = (str: string, maxWidth: number, fontSize = 12) => {
  const ellipsis = '...';
  const ellipsisLength = G6.Util.getTextSize(ellipsis, fontSize)[0];
  let currentWidth = 0;
  let res = str;
  const pattern = /'[\u4E00-\u9FA5]+/; // distinguish the Chinese characters and letters
  str.split('').forEach((letter, i) => {
    if (currentWidth > maxWidth - ellipsisLength) return;
    if (pattern.test(letter)) {
      // Chinese characters
      currentWidth += fontSize;
    } else {
      // get the width of single letter according to the fontSize
      currentWidth += G6.Util.getLetterWidth(letter, fontSize);
    }
    if (currentWidth > maxWidth - ellipsisLength) {
      res = `${str.substring(0, i)}${ellipsis}`;
    }
  });
  return res;
};
