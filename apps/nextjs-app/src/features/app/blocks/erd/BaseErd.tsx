import { Relationship } from '@teable/core';
import {
  getBaseErd,
  type IBaseErdVo,
  type IBaseErdEdge,
  type IBaseErdTableNode,
} from '@teable/openapi';
import { useFieldStaticGetter } from '@teable/sdk/hooks';
import { Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  MarkerType,
} from 'reactflow';
import { tableConfig } from '@/features/i18n/table.config';
import { BaseErdTableNode } from './BaseErdTableNode';
import { SelfConnectingEdge } from './SelfConnectingEdge';

const openTable = (baseId: string, tableId: string) => {
  const url = new URL(`/base/${baseId}/${tableId}`, window.location.origin);
  window.open(url.toString(), '_blank');
};

const buildMarkerId = (baseId: string) => {
  return {
    one: `${baseId}-one`,
    many: `${baseId}-many`,
  };
};

const getMarkerId = (baseId: string, relationship: Relationship) => {
  const { one, many } = buildMarkerId(baseId);
  const start =
    relationship === Relationship.OneOne || relationship === Relationship.OneMany ? one : many;
  const end =
    relationship === Relationship.OneOne || relationship === Relationship.ManyOne ? one : many;
  return {
    start,
    end,
  };
};

const buildNodes = (
  baseId: string,
  nodes: IBaseErdTableNode[],
  fieldStaticGetter: ReturnType<typeof useFieldStaticGetter>,
  openTable: (baseId: string, tableId: string) => void
) => {
  const col = Math.ceil(Math.sqrt(nodes.length));
  const yMap: Record<number, { rowIndex: number; height: number }> = {};
  const resultNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const colIndex = i % col;
    const x = colIndex * 300;
    const y = yMap[colIndex]?.height ?? 0;
    resultNodes.push({
      id: node.id,
      type: 'tableNode',
      data: {
        ...node,
        baseId,
        fieldStaticGetter,
        openTable,
      },
      position: { x, y },
    });
    const rowIndex = yMap[colIndex]?.rowIndex ?? 0;
    const height = node.fields.length * 24 + (node.fields.length - 1) * 8 + 100;
    yMap[colIndex] = {
      rowIndex: rowIndex + 1,
      height: y + height,
    };
  }
  return resultNodes;
};

const buildEdges = (
  baseId: string,
  edges: IBaseErdEdge[],
  translationMap: Record<string, string>,
  fieldStaticGetter: ReturnType<typeof useFieldStaticGetter>,
  showAllRelations: boolean
) => {
  return edges
    .filter((edge) => {
      return showAllRelations || Boolean(edge.relationship);
    })
    .map((edge) => {
      const markerStart = !edge.isOneWay
        ? {
            type: MarkerType.ArrowClosed,
            orient: 'auto-start-reverse',
            width: 16,
            height: 16,
          }
        : undefined;
      const markerEnd = {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
      };
      const { source, target } = edge;

      const relationshipLabel = edge.relationship ? translationMap[edge.relationship] : '';
      // `[${source.tableName}]${source.fieldName} - ${relationshipLabel} - [${target.tableName}]${target.fieldName}`

      const { start, end } = getMarkerId(baseId, edge.relationship ?? Relationship.OneOne);
      const isSelfConnecting = source.tableId === target.tableId;
      const { title } =
        edge.type === 'lookup'
          ? { title: translationMap['lookup'] }
          : fieldStaticGetter(edge.type, {
              isLookup: false,
              hasAiConfig: false,
              deniedReadRecord: false,
            });
      return {
        id: `${source.tableId}-${source.fieldId}-${target.tableId}-${target.fieldId}`,
        type: isSelfConnecting ? 'selfConnecting' : 'default',
        source: source.tableId,
        target: target.tableId,
        sourceHandle: source.fieldId,
        targetHandle: target.fieldId,
        style: { strokeWidth: 1 },
        label: relationshipLabel ? relationshipLabel : title,
        data: {},
        markerStart: markerStart,
        markerEnd: markerEnd,
      };
    });
};

// todo: custom markers for edges
const CustomMarkers = ({ baseId }: { baseId: string }) => {
  return (
    <svg style={{ position: 'absolute', top: 0, left: 0 }}>
      <defs>
        <marker
          id={buildMarkerId(baseId).one}
          markerWidth="16"
          markerHeight="16"
          viewBox="-10 -10 20 20"
          markerUnits="strokeWidth"
          orient="auto-start-reverse"
          refX="0"
          refY="0"
        >
          <polyline
            strokeLinecap="round"
            strokeLinejoin="round"
            points="-5,-4 0,0 -5,4 -5,-4"
            style={{ stroke: 'rgb(177, 177, 183)', fill: 'rgb(177, 177, 183)', strokeWidth: 1 }}
          ></polyline>
        </marker>
        <marker
          id={buildMarkerId(baseId).many}
          markerWidth="16"
          markerHeight="16"
          viewBox="-10 -10 20 20"
          markerUnits="strokeWidth"
          orient="auto-start-reverse"
          refX="0"
          refY="0"
        >
          <circle
            cx="8"
            cy="8"
            r="8"
            style={{ stroke: 'rgb(177, 177, 183)', fill: 'rgb(177, 177, 183)', strokeWidth: 1 }}
          ></circle>
        </marker>
      </defs>
    </svg>
  );
};

const connectionLineStyle = { stroke: '#fff' };
const nodeTypes = {
  tableNode: BaseErdTableNode,
};
const edgeTypes = {
  selfConnecting: SelfConnectingEdge,
};

export const BaseErd = (props: { baseId: string }) => {
  const { baseId } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fieldStaticGetter = useFieldStaticGetter();
  const [showAllRelations, setShowAllRelations] = useState(false);
  const [baseErd, setBaseErd] = useState<IBaseErdVo | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const translationMap = useMemo(() => {
    return {
      [Relationship.OneOne]: t('table:field.editor.oneToOne'),
      [Relationship.OneMany]: t('table:field.editor.oneToMany'),
      [Relationship.ManyOne]: t('table:field.editor.manyToOne'),
      [Relationship.ManyMany]: t('table:field.editor.manyToMany'),
      lookup: t('sdk:field.title.lookup'),
    };
  }, [t]);

  useEffect(() => {
    getBaseErd(baseId).then((baseErd) => {
      setBaseErd(baseErd.data);
    });
  }, [baseId]);

  useEffect(() => {
    if (baseErd) {
      const { baseId, nodes, edges } = baseErd;
      setNodes(buildNodes(baseId, nodes, fieldStaticGetter, openTable));
      setEdges(buildEdges(baseId, edges, translationMap, fieldStaticGetter, showAllRelations));
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [baseErd, showAllRelations, translationMap, fieldStaticGetter, setNodes, setEdges]);

  return (
    <>
      <CustomMarkers baseId={baseId} />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineStyle={connectionLineStyle}
        fitView
        minZoom={0.25}
        maxZoom={1}
        // onEdgeMouseEnter={(event, edge) => {
        //   setEdges((prev) => {
        //     return prev.map((e) => {
        //       if (e.id === edge.id) {
        //         return { ...e, style: { ...e.style, strokeWidth: 1.5 }, label: e.data.label };
        //       }
        //       return e;
        //     });
        //   });
        // }}
        // onEdgeMouseLeave={(event, edge) => {
        //   setEdges((prev) => {
        //     return prev.map((e) => {
        //       return { ...e, style: { ...e.style, strokeWidth: 1 }, label: '' };
        //     });
        //   });
        // }}
      >
        <Background variant={BackgroundVariant.Dots} className="bg-secondary" />
        <Controls
          className="Controls"
          fitViewOptions={{
            duration: 500,
          }}
        />
        <div className="absolute right-10 top-10 z-10 flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch checked={showAllRelations} onCheckedChange={setShowAllRelations} />
            <Label>Show All Relations</Label>
          </div>
        </div>
      </ReactFlow>
    </>
  );
};
