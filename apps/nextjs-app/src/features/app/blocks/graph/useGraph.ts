import type { GraphData, Graph as IGraph } from '@antv/g6';
import G6 from '@antv/g6';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

export const useGraph = (ref: RefObject<HTMLDivElement>, width: number, height: number) => {
  const graphRef = useRef<IGraph>();

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
        size: [120, 40],
      },
      modes: {
        default: [
          {
            type: 'zoom-canvas',
          },
          {
            type: 'drag-canvas',
            enableOptimize: true,
          },
          'drag-node',
          'brush-select',
        ],
      },
      animate: true,
    });
    graphRef.current = graph;
    return () => {
      graphRef.current?.destroy();
    };
  }, [ref]);

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

  useEffect(() => {
    const graph = graphRef.current;
    if (graph == undefined) {
      return;
    }
    graph.changeSize(width, height);
    graph.render();
  }, [height, width]);

  return { updateGraph };
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
