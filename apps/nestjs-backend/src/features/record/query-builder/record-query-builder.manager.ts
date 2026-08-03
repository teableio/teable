import type { IFieldSelectName } from './field-select.type';
import type {
  IReadonlyQueryBuilderState,
  IMutableQueryBuilderState,
  IRecordQueryContext,
} from './record-query-builder.interface';

/**
 * Central manager for query-builder shared state.
 * Implements both readonly and mutable interfaces; pass as readonly where mutation is not allowed.
 */
export class RecordQueryBuilderManager implements IMutableQueryBuilderState {
  constructor(public readonly context: IRecordQueryContext) {}
  private readonly fieldIdToCteName: Map<string, string> = new Map();
  private readonly fieldIdToSelection: Map<string, IFieldSelectName> = new Map();
  private readonly joinedCtes: Set<string> = new Set();
  private mainAlias?: string;
  private mainSource?: string;
  private originalMainSource?: string;
  private baseCteName?: string;

  // Readonly API
  getFieldCteMap(): ReadonlyMap<string, string> {
    return this.fieldIdToCteName;
  }

  getSelectionMap(): ReadonlyMap<string, IFieldSelectName> {
    return this.fieldIdToSelection;
  }

  getContext(): IRecordQueryContext {
    return this.context;
  }

  getMainTableAlias(): string | undefined {
    return this.mainAlias;
  }

  getMainTableSource(): string | undefined {
    return this.mainSource;
  }

  getOriginalMainTableSource(): string | undefined {
    return this.originalMainSource ?? this.mainSource;
  }

  getBaseCteName(): string | undefined {
    return this.baseCteName;
  }

  hasFieldCte(fieldId: string): boolean {
    return this.fieldIdToCteName.has(fieldId);
  }

  getCteName(fieldId: string): string | undefined {
    return this.fieldIdToCteName.get(fieldId);
  }

  isCteJoined(cteName: string): boolean {
    return this.joinedCtes.has(cteName);
  }

  // Mutable API
  setFieldCte(fieldId: string, cteName: string): void {
    this.fieldIdToCteName.set(fieldId, cteName);
  }

  clearFieldCtes(): void {
    this.fieldIdToCteName.clear();
    this.joinedCtes.clear();
  }

  setSelection(fieldId: string, selection: IFieldSelectName): void {
    this.fieldIdToSelection.set(fieldId, selection);
  }

  deleteSelection(fieldId: string): void {
    this.fieldIdToSelection.delete(fieldId);
  }

  clearSelections(): void {
    this.fieldIdToSelection.clear();
  }

  setMainTableAlias(alias: string): void {
    this.mainAlias = alias;
  }

  setMainTableSource(source: string): void {
    this.mainSource = source;
    if (!this.originalMainSource) {
      this.originalMainSource = source;
    }
  }

  setBaseCteName(cteName: string | undefined): void {
    this.baseCteName = cteName;
  }

  markCteJoined(cteName: string): void {
    this.joinedCtes.add(cteName);
  }
}

// A helper to expose a readonly view from a mutable manager when needed
export function asReadonlyState(state: IMutableQueryBuilderState): IReadonlyQueryBuilderState {
  return state as unknown as IReadonlyQueryBuilderState;
}

/**
 * Scoped state that shares the CTE map from a base state but maintains
 * an isolated selection map for temporary/select-scope computations.
 */
export class ScopedSelectionState implements IMutableQueryBuilderState {
  private readonly base: IReadonlyQueryBuilderState;
  private readonly localSelection: Map<string, IFieldSelectName> = new Map();

  constructor(base: IReadonlyQueryBuilderState) {
    this.base = base;
  }

  // Readonly over CTE map
  getFieldCteMap(): ReadonlyMap<string, string> {
    return this.base.getFieldCteMap();
  }

  getSelectionMap(): ReadonlyMap<string, IFieldSelectName> {
    return this.localSelection;
  }

  getContext(): IRecordQueryContext {
    return this.base.getContext();
  }

  hasFieldCte(fieldId: string): boolean {
    return this.base.hasFieldCte(fieldId);
  }

  getCteName(fieldId: string): string | undefined {
    return this.base.getCteName(fieldId);
  }

  isCteJoined(cteName: string): boolean {
    return this.base.isCteJoined(cteName);
  }

  getMainTableAlias(): string | undefined {
    return this.base.getMainTableAlias();
  }

  getMainTableSource(): string | undefined {
    return this.base.getMainTableSource();
  }

  getOriginalMainTableSource(): string | undefined {
    return this.base.getOriginalMainTableSource();
  }

  getBaseCteName(): string | undefined {
    return this.base.getBaseCteName();
  }

  // Mutations: selection only
  setSelection(fieldId: string, selection: IFieldSelectName): void {
    this.localSelection.set(fieldId, selection);
  }

  deleteSelection(fieldId: string): void {
    this.localSelection.delete(fieldId);
  }

  clearSelections(): void {
    this.localSelection.clear();
  }

  // CTE mutations are unsupported in scoped selection state
  setFieldCte(_fieldId: string, _cteName: string): void {
    // intentionally no-op; CTE writes must happen on the manager
    throw new Error('setFieldCte is not supported on ScopedSelectionState');
  }

  clearFieldCtes(): void {
    throw new Error('clearFieldCtes is not supported on ScopedSelectionState');
  }

  setMainTableAlias(_alias: string): void {
    throw new Error('setMainTableAlias is not supported on ScopedSelectionState');
  }

  setMainTableSource(_source: string): void {
    throw new Error('setMainTableSource is not supported on ScopedSelectionState');
  }

  setBaseCteName(_cteName: string | undefined): void {
    throw new Error('setBaseCteName is not supported on ScopedSelectionState');
  }

  markCteJoined(_cteName: string): void {
    throw new Error('markCteJoined is not supported on ScopedSelectionState');
  }
}
