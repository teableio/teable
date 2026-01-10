export type DebugJsonField = {
  raw: string | null;
  parsed: unknown | null;
  parseError: string | null;
};

export type DebugTableMeta = {
  id: string;
  baseId: string;
  name: string;
  description: string | null;
  icon: string | null;
  dbTableName: string;
  dbViewName: string | null;
  version: number;
  order: number;
  createdTime: string;
  createdBy: string;
  lastModifiedTime: string | null;
  lastModifiedBy: string | null;
  deletedTime: string | null;
};

export type DebugTableSummary = {
  id: string;
  baseId: string;
  name: string;
  dbTableName: string;
};

export type DebugFieldMeta = {
  id: string;
  tableId: string;
  tableName: string;
  baseId: string;
  name: string;
  description: string | null;
  type: string;
  cellValueType: string;
  isMultipleCellValue: boolean | null;
  dbFieldType: string;
  dbFieldName: string;
  notNull: boolean | null;
  unique: boolean | null;
  isPrimary: boolean | null;
  isComputed: boolean | null;
  isLookup: boolean | null;
  isConditionalLookup: boolean | null;
  isPending: boolean | null;
  hasError: boolean | null;
  lookupLinkedFieldId: string | null;
  order: number;
  version: number;
  createdTime: string;
  createdBy: string;
  lastModifiedTime: string | null;
  lastModifiedBy: string | null;
  deletedTime: string | null;
  options: DebugJsonField;
  lookupOptions: DebugJsonField;
  meta: DebugJsonField;
  aiConfig: DebugJsonField;
};

export type DebugFieldSummary = {
  id: string;
  tableId: string;
  tableName: string;
  baseId: string;
  name: string;
  type: string;
  isPrimary: boolean | null;
  isComputed: boolean | null;
  isLookup: boolean | null;
  isPending: boolean | null;
  hasError: boolean | null;
};

export type DebugFieldRelationDirection = 'up' | 'down' | 'both';

export type DebugFieldRelationOptions = {
  direction?: DebugFieldRelationDirection;
  maxDepth?: number | null;
  sameTableOnly?: boolean;
};

export type DebugFieldRelationEdgeKind = 'same_record' | 'cross_record';

export type DebugFieldRelationEdgeSemantic =
  | 'formula_ref'
  | 'lookup_source'
  | 'lookup_link'
  | 'link_title'
  | 'rollup_source'
  | 'conditional_rollup_source'
  | 'conditional_lookup_source';

export type DebugFieldRelationEdge = {
  fromFieldId: string;
  toFieldId: string;
  fromTableId: string;
  toTableId: string;
  kind: DebugFieldRelationEdgeKind;
  semantic?: DebugFieldRelationEdgeSemantic;
  linkFieldId?: string;
};

export type DebugFieldRelationNode = {
  id: string;
  tableId: string | null;
  tableName: string | null;
  name: string | null;
  type: string | null;
  isComputed: boolean | null;
  isLookup: boolean | null;
  isPrimary: boolean | null;
  isPending: boolean | null;
  hasError: boolean | null;
  depthUp: number | null;
  depthDown: number | null;
};

export type DebugFieldRelationReport = {
  field: DebugFieldMeta;
  table: DebugTableSummary;
  baseId: string;
  options: {
    direction: DebugFieldRelationDirection;
    maxDepth: number | null;
    sameTableOnly: boolean;
  };
  nodes: Record<string, DebugFieldRelationNode>;
  edges: ReadonlyArray<DebugFieldRelationEdge>;
  stats: {
    nodeCount: number;
    edgeCount: number;
    maxDepthUp: number;
    maxDepthDown: number;
  };
};

// Raw record types for underlying database access
export type DebugRawRecord = Record<string, unknown>;

export type DebugRawRecordQueryOptions = {
  limit?: number;
  offset?: number;
};

export type DebugRawRecordQueryResult = {
  dbTableName: string;
  records: ReadonlyArray<DebugRawRecord>;
  total: number;
};
