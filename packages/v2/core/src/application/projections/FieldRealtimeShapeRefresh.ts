import { FieldUpdated } from '../../domain/table/events/FieldUpdated';
import type { ITableFieldPersistenceDTO } from '../../ports/mappers/TableMapper';
import type { RealtimeChange } from '../../ports/RealtimeChange';

const shapeRefreshTriggerProperties = new Set([
  'type',
  'expression',
  'lookupOptions',
  'rollupConfig',
  'linkConfig',
  'linkRelationship',
  'relationship',
  'isOneWay',
]);
const dynamicShapeFieldTypes = new Set([
  'formula',
  'rollup',
  'conditionalRollup',
  'conditionalLookup',
]);
const dynamicShapeKeys = [
  'isComputed',
  'isLookup',
  'isConditionalLookup',
  'lookupOptions',
  'cellValueType',
  'isMultipleCellValue',
  'config',
  'innerType',
  'innerOptions',
] as const;

type DynamicShapeKey = (typeof dynamicShapeKeys)[number];
type DynamicShapeSnapshot = Record<DynamicShapeKey, unknown>;

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const emptyDynamicShapeSnapshot = (): DynamicShapeSnapshot => ({
  isComputed: null,
  isLookup: null,
  isConditionalLookup: null,
  lookupOptions: null,
  cellValueType: null,
  isMultipleCellValue: null,
  config: null,
  innerType: null,
  innerOptions: null,
});

const readShapeValue = (fieldDto: ITableFieldPersistenceDTO, key: DynamicShapeKey): unknown => {
  if (!hasOwn(fieldDto, key)) {
    return null;
  }
  return (fieldDto as Record<string, unknown>)[key];
};

const withComputedShape = (fieldDto: ITableFieldPersistenceDTO): DynamicShapeSnapshot => ({
  ...emptyDynamicShapeSnapshot(),
  isComputed: readShapeValue(fieldDto, 'isComputed'),
  cellValueType: readShapeValue(fieldDto, 'cellValueType'),
  isMultipleCellValue: readShapeValue(fieldDto, 'isMultipleCellValue'),
});

class FieldRealtimeShapeSnapshotVisitor {
  visit(fieldDto: ITableFieldPersistenceDTO): DynamicShapeSnapshot {
    if (fieldDto.type === 'formula') {
      return this.visitFormulaField(fieldDto);
    }

    if (fieldDto.type === 'rollup') {
      return this.visitRollupField(fieldDto);
    }

    if (fieldDto.type === 'conditionalRollup') {
      return this.visitConditionalRollupField(fieldDto);
    }

    if (fieldDto.type === 'conditionalLookup') {
      return this.visitConditionalLookupField(fieldDto);
    }

    if (fieldDto.type === 'link') {
      return this.visitLinkField(fieldDto);
    }

    if (fieldDto.isLookup === true) {
      return this.visitLookupField(fieldDto);
    }

    return this.visitPlainField();
  }

  private visitPlainField(): DynamicShapeSnapshot {
    return emptyDynamicShapeSnapshot();
  }

  private visitFormulaField(
    fieldDto: Extract<ITableFieldPersistenceDTO, { type: 'formula' }>
  ): DynamicShapeSnapshot {
    return withComputedShape(fieldDto);
  }

  private visitRollupField(
    fieldDto: Extract<ITableFieldPersistenceDTO, { type: 'rollup' }>
  ): DynamicShapeSnapshot {
    return {
      ...withComputedShape(fieldDto),
      config: readShapeValue(fieldDto, 'config'),
    };
  }

  private visitConditionalRollupField(
    fieldDto: Extract<ITableFieldPersistenceDTO, { type: 'conditionalRollup' }>
  ): DynamicShapeSnapshot {
    return {
      ...withComputedShape(fieldDto),
      config: readShapeValue(fieldDto, 'config'),
    };
  }

  private visitLinkField(
    fieldDto: Extract<ITableFieldPersistenceDTO, { type: 'link' }>
  ): DynamicShapeSnapshot {
    return withComputedShape(fieldDto);
  }

  private visitLookupField(fieldDto: ITableFieldPersistenceDTO): DynamicShapeSnapshot {
    return {
      ...withComputedShape(fieldDto),
      isLookup: readShapeValue(fieldDto, 'isLookup'),
      isConditionalLookup: readShapeValue(fieldDto, 'isConditionalLookup'),
      lookupOptions: readShapeValue(fieldDto, 'lookupOptions'),
    };
  }

  private visitConditionalLookupField(
    fieldDto: Extract<ITableFieldPersistenceDTO, { type: 'conditionalLookup' }>
  ): DynamicShapeSnapshot {
    return {
      ...withComputedShape(fieldDto),
      innerType: readShapeValue(fieldDto, 'innerType'),
      innerOptions: readShapeValue(fieldDto, 'innerOptions'),
    };
  }
}

const fieldRealtimeShapeSnapshotVisitor = new FieldRealtimeShapeSnapshotVisitor();

const getChangedFieldType = (event: FieldUpdated, key: 'oldValue' | 'newValue') => {
  const value = event.getPropertyChange('type')?.[key];
  return typeof value === 'string' ? value : undefined;
};

const shouldAttemptFieldShapeRefresh = (event: FieldUpdated): boolean =>
  event.updatedProperties.some((property) => shapeRefreshTriggerProperties.has(property));

const hasDynamicShapeSnapshot = (snapshot: DynamicShapeSnapshot): boolean =>
  Object.values(snapshot).some((value) => value !== null);

const hasDynamicFieldTypeChange = (event: FieldUpdated): boolean =>
  [getChangedFieldType(event, 'oldValue'), getChangedFieldType(event, 'newValue')].some(
    (type) => type != null && dynamicShapeFieldTypes.has(type)
  );

export const buildFieldShapeRefreshChanges = (
  fieldDto: ITableFieldPersistenceDTO,
  event: FieldUpdated,
  seenPaths: Set<string>
): RealtimeChange[] => {
  if (!shouldAttemptFieldShapeRefresh(event)) {
    return [];
  }

  const snapshot = fieldRealtimeShapeSnapshotVisitor.visit(fieldDto);
  if (!hasDynamicShapeSnapshot(snapshot) && !hasDynamicFieldTypeChange(event)) {
    return [];
  }

  return dynamicShapeKeys.flatMap((key) => {
    const path = [key];
    const pathKey = JSON.stringify(path);
    if (seenPaths.has(pathKey)) {
      return [];
    }
    seenPaths.add(pathKey);

    return [
      {
        type: 'set' as const,
        path,
        value: snapshot[key],
      },
    ];
  });
};
