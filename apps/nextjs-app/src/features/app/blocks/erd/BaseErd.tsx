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
import { CustomMarkers, getMarker } from './CustomMakers';
import { SelfConnectingEdge } from './SelfConnectingEdge';

const openTable = (baseId: string, tableId: string) => {
  const url = new URL(`/base/${baseId}/${tableId}`, window.location.origin);
  window.open(url.toString(), '_blank');
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
      const { source, target } = edge;

      const relationshipLabel = edge.relationship ? translationMap[edge.relationship] : '';
      // `[${source.tableName}]${source.fieldName} - ${relationshipLabel} - [${target.tableName}]${target.fieldName}`

      const defaultMarkerStart = !edge.isOneWay
        ? {
            type: MarkerType.ArrowClosed,
            orient: 'auto-start-reverse',
            width: 16,
            height: 16,
          }
        : undefined;
      const defaultMarkerEnd = {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
      };
      const { start: markerStart, end: markerEnd } = edge.relationship
        ? getMarker(baseId, edge.relationship)
        : { start: defaultMarkerStart, end: defaultMarkerEnd };

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
        markerStart,
        markerEnd,
      };
    });
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
  const [nodes, setNodes, onNodesChange] = useNodesState<IBaseErdTableNode>([]);
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
      const { baseId, nodes } = baseErd;
      setNodes(buildNodes(baseId, nodes, fieldStaticGetter, openTable));
    } else {
      setNodes([]);
    }
  }, [baseErd, fieldStaticGetter, setNodes]);

  useEffect(() => {
    if (baseErd) {
      const { baseId, edges } = baseErd;
      setEdges(buildEdges(baseId, edges, translationMap, fieldStaticGetter, showAllRelations));
    } else {
      setEdges([]);
    }
  }, [baseErd, showAllRelations, translationMap, fieldStaticGetter, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      connectionLineStyle={connectionLineStyle}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      fitView
      minZoom={0.25}
      maxZoom={1.5}
    >
      <CustomMarkers baseId={baseId} />
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
  );
};
