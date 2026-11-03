import type {
  ComplexityAssessment,
  OperationDescriptor,
  SchemaComplexityAssumptions,
} from '@teable/v2-complexity';
import type { DomainError, IExecutionContext } from '@teable/v2-core';
import type { Result } from 'neverthrow';

export const previewOperationValues = [
  'field.delete',
  'field.convert',
  'table.delete',
  'table.duplicate',
  'records.paste',
  'records.bulkUpdate',
  'records.bulkDelete',
  'base.duplicate',
] as const;

export type PreviewOperation = (typeof previewOperationValues)[number];

export const isPreviewOperation = (value: string): value is PreviewOperation =>
  previewOperationValues.some((operation) => operation === value);

export type PreviewOutcome = 'ready' | 'blocked' | 'incomplete';

export type PreviewMeasure =
  | { readonly basis: 'exact'; readonly value: number; readonly unit: string }
  | {
      readonly basis: 'estimate';
      readonly value: number;
      readonly unit: string;
      readonly source: string;
    }
  | {
      readonly basis: 'range';
      readonly lower: number | null;
      readonly expected: number | null;
      readonly upper: number | null;
      readonly unit: string;
      readonly source: string;
    }
  | { readonly basis: 'unknown'; readonly unit: string; readonly reason: string };

export type PreviewResourceKind =
  | 'base'
  | 'space'
  | 'table'
  | 'field'
  | 'view'
  | 'record'
  | 'attachment'
  | 'workflow'
  | 'share'
  | 'app'
  | 'runtime'
  | 'host';

/**
 * Public resource references are either authorized identities or redacted aggregates.
 * A redacted reference deliberately has no identity fields.
 */
export type PreviewResourceReference =
  | {
      readonly visibility: 'authorized';
      readonly kind: PreviewResourceKind;
      readonly id: string;
      readonly name?: string;
    }
  | {
      readonly visibility: 'redacted';
      readonly kind: PreviewResourceKind;
      readonly quantity: PreviewMeasure;
      readonly reason: string;
    };

export type PreviewEffectKind =
  | 'dependency.change'
  | 'field.conversion'
  | 'record.insert'
  | 'record.update'
  | 'record.delete'
  | 'record.rewrite'
  | 'resource.copy'
  | 'resource.trash'
  | 'resource.permanent-delete'
  | 'host.effect';

export type PreviewEffect = {
  /** Stable machine-readable consequence code. */
  readonly code: string;
  readonly kind: PreviewEffectKind;
  readonly summary?: string;
  readonly resource?: PreviewResourceReference;
  readonly relatedResources?: ReadonlyArray<PreviewResourceReference>;
  readonly measures: Readonly<Record<string, PreviewMeasure>>;
};

export type PreviewIssue = {
  /** Stable machine-readable issue code. */
  readonly code: string;
  readonly message?: string;
  readonly resource?: PreviewResourceReference;
};

export type PreviewOptions = {
  readonly detail: 'summary' | 'full';
  readonly includeComplexity: boolean;
  readonly maxItems: number;
};

export type OperationPreviewRequest = {
  readonly operation: PreviewOperation;
  readonly input: unknown;
  readonly options?: {
    readonly detail?: 'summary' | 'full';
    readonly includeComplexity?: boolean;
    readonly maxItems?: number;
  };
};

export type OperationPreview = {
  readonly operation: PreviewOperation;
  readonly outcome: PreviewOutcome;
  readonly effects: ReadonlyArray<PreviewEffect>;
  readonly blockers: ReadonlyArray<PreviewIssue>;
  readonly warnings: ReadonlyArray<PreviewIssue>;
  readonly coverage: {
    readonly known: ReadonlyArray<string>;
    readonly unknown: ReadonlyArray<string>;
  };
  readonly complexity: ComplexityAssessment | null;
  readonly authorization: 'checked' | 'not-applicable';
  readonly observedAt: string;
  readonly consistency: 'best-effort' | 'snapshot';
  readonly requestDigest: string;
  readonly implementation: {
    readonly plannerVersion: string;
    readonly executionPath: string;
  };
};

/** Read-only operation facts used by the canonical service for optional complexity analysis. */
export type PreviewComplexityProjection = {
  readonly tableId: string;
  readonly operation: OperationDescriptor;
  readonly assumptions?: SchemaComplexityAssumptions;
  readonly includeCatalogStats: boolean;
  /** Host-authorized table scope. Omission restricts analysis to the seed table. */
  readonly authorizedTableIds?: ReadonlyArray<string>;
  readonly coverage: {
    readonly known: ReadonlyArray<string>;
    readonly unknown: ReadonlyArray<string>;
  };
  readonly warnings: ReadonlyArray<PreviewIssue>;
};

/** Planner result before canonical service-owned metadata is attached. */
export type OperationPreviewPlan = Pick<
  OperationPreview,
  'effects' | 'blockers' | 'warnings' | 'coverage' | 'complexity' | 'authorization' | 'consistency'
> & {
  readonly complexityProjection?: PreviewComplexityProjection;
};

export interface IPreviewPlanner<TInput = unknown> {
  readonly operation: PreviewOperation;
  readonly plannerVersion: string;
  readonly executionPath: string;
  preview(
    context: IExecutionContext,
    input: TInput,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>>;
}

export interface IOperationPreviewService {
  preview(
    context: IExecutionContext,
    request: OperationPreviewRequest
  ): Promise<Result<OperationPreview, DomainError>>;
}

export type PreviewSupportLevel = 'full' | 'partial' | 'validation-only';

export type PreviewCapability = {
  readonly operation: PreviewOperation;
  readonly canonicalWriteRoute: string;
  readonly supportLevel: PreviewSupportLevel;
  readonly requiredPermissionScope: string;
  readonly detailLevels: ReadonlyArray<'summary' | 'full'>;
  readonly limitations: ReadonlyArray<string>;
};

export type PreviewOperationRegistration<TInput = unknown> = {
  readonly operation: PreviewOperation;
  readonly parseInput: (input: unknown) => Result<TInput, DomainError>;
  readonly planner: IPreviewPlanner<TInput>;
  readonly capability: Omit<PreviewCapability, 'operation'>;
};
