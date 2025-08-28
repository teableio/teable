import { Relationship } from '@teable/core';
import { getBaseErd } from '@teable/openapi';
import type { IBaseErdEdge, IBaseErdVo, IBaseErdTableNode } from '@teable/openapi';
import { useFieldStaticGetter } from '@teable/sdk/hooks';
import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from '@teable/ui-lib/shadcn';
import { uniq } from 'lodash';
import { FilterIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState, useEffect, useMemo, useCallback } from 'react';
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
    // 24(h6) is the height of a field, 8(gap-2) is the gap between fields, 100 is the gap between tables
    const height = node.fields.length * 24 + (node.fields.length + 1) * 8 + 100;
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
  showEdgeTypes: IBaseErdEdge['type'][],
  translationMap: Record<string, string>,
  getEdgeTypeInfo: (type: IBaseErdEdge['type']) => { title: string }
) => {
  return edges
    .filter((edge) => {
      return Boolean(edge.relationship) || showEdgeTypes.includes(edge.type);
    })
    .map((edge) => {
      const { source, target } = edge;

      const wayLabel = edge.isOneWay ? translationMap['oneWay'] : translationMap['twoWay'];
      const relationshipLabel = edge.relationship
        ? `${translationMap[edge.relationship]}(${wayLabel})`
        : '';
      // `[${source.tableName}]${source.fieldName} - ${relationshipLabel} - [${target.tableName}]${target.fieldName}`

      const defaultMarkerEnd = {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
      };
      const { start: markerStart, end: markerEnd } = edge.relationship
        ? getMarker(baseId, edge.relationship)
        : { start: undefined, end: defaultMarkerEnd };

      const isSelfConnecting = source.tableId === target.tableId;
      const { title } = getEdgeTypeInfo(edge.type);
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
  const [showEdgeTypes, setShowEdgeTypes] = useState<IBaseErdEdge['type'][]>([]);
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
      oneWay: t('sdk:field.link.oneWay'),
      twoWay: t('sdk:field.link.twoWay'),
    };
  }, [t]);

  useEffect(() => {
    getBaseErd(baseId).then((baseErd) => {
      setBaseErd(baseErd.data);
    });
  }, [baseId]);

  const getEdgeTypeInfo = useCallback(
    (type: IBaseErdEdge['type']) => {
      const { title } =
        type === 'lookup'
          ? { title: translationMap['lookup'] }
          : fieldStaticGetter(type, {
              isLookup: false,
              hasAiConfig: false,
              deniedReadRecord: false,
            });
      return { type, title };
    },
    [translationMap, fieldStaticGetter]
  );

  const allEdgeTypes = useMemo(() => {
    const { edges = [] } = baseErd ?? {};
    return uniq(edges.filter((edge) => !edge.relationship).map((edge) => edge.type))
      .sort()
      .map((type) => getEdgeTypeInfo(type));
  }, [baseErd, getEdgeTypeInfo]);

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
      setEdges(buildEdges(baseId, edges, showEdgeTypes, translationMap, getEdgeTypeInfo));
    } else {
      setEdges([]);
    }
  }, [baseErd, translationMap, setEdges, showEdgeTypes, getEdgeTypeInfo]);

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
      maxZoom={1.25}
    >
      <CustomMarkers baseId={baseId} />
      <Background variant={BackgroundVariant.Dots} className="bg-secondary" />
      <Controls
        className="Controls"
        fitViewOptions={{
          duration: 500,
        }}
      />
      <div className="absolute right-10 top-10 z-10 flex ">
        {allEdgeTypes.length > 0 && (
          <Popover modal>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="flex items-center gap-2">
                <FilterIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-fit min-w-24 p-0">
              {allEdgeTypes.map(({ type, title }) => (
                <div key={type} className="w-min-content flex items-center gap-2 p-2">
                  <Switch
                    checked={showEdgeTypes.includes(type)}
                    onCheckedChange={(checked) => {
                      setShowEdgeTypes((prev) =>
                        checked ? [...prev, type] : prev.filter((t) => t !== type)
                      );
                    }}
                  />
                  <Label>{title}</Label>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </ReactFlow>
  );
};
