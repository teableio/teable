import { Injectable } from '@nestjs/common';
import { duplicateBaseRoSchema, type IDuplicateBaseRo } from '@teable/openapi';
import {
  hostPreviewConcernValues,
  PreviewPlannerRegistry,
  v2CommandExplainTokens,
  type HostPreviewConcern,
  type HostPreviewRegistration,
  type IHostPreviewAdapter,
  type OperationPreviewPlan,
  type PreviewEffect,
  type PreviewIssue,
  type PreviewMeasure,
  type PreviewOptions,
} from '@teable/v2-command-explain';
import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
import type { IV2Decision } from '../canary';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import {
  BaseDuplicateService,
  type DuplicateBaseV2HostPreviewAdmission,
  type DuplicateBaseV2HostPreviewExtension,
  type DuplicateBaseV2Preparation,
  type DuplicateBaseV2PreviewFacts,
} from './base-duplicate.service';
import { BaseService } from './base.service';

export type BaseDuplicatePreviewInput = {
  readonly duplicateBaseRo: IDuplicateBaseRo;
};

const exact = (value: number, unit: string): PreviewMeasure => ({
  basis: 'exact',
  value,
  unit,
});

const unknown = (unit: string, reason: string): PreviewMeasure => ({
  basis: 'unknown',
  unit,
  reason,
});

const invalidInput = (code: string, message: string): Result<never, DomainError> =>
  err(domainError.validation({ code, message }));

export const parseBaseDuplicatePreviewInput = (
  input: unknown
): Result<BaseDuplicatePreviewInput, DomainError> => {
  if (typeof input !== 'object' || input == null || Array.isArray(input)) {
    return invalidInput(
      'preview.base.duplicate.invalid_input',
      'Expected a base duplicate request object.'
    );
  }

  const record = input as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'allowCrossBase')) {
    return invalidInput(
      'preview.base.duplicate.allow_cross_base_unsupported',
      'allowCrossBase is not accepted by the advertised POST /base/duplicate write route.'
    );
  }
  if (Object.prototype.hasOwnProperty.call(record, 'duplicateMode')) {
    return invalidInput(
      'preview.base.duplicate.mode_unsupported',
      'duplicateMode is not accepted by the advertised POST /base/duplicate write route.'
    );
  }

  const parsed = duplicateBaseRoSchema.safeParse(record);
  if (!parsed.success) {
    return invalidInput(
      'preview.base.duplicate.invalid_input',
      'Base duplicate input does not match the route schema.'
    );
  }

  return ok({ duplicateBaseRo: parsed.data });
};

const buildResourceEffects = (facts: DuplicateBaseV2PreviewFacts): PreviewEffect[] => {
  const { input, selection, records, links } = facts;
  const sourceBase = {
    visibility: 'authorized' as const,
    kind: 'base' as const,
    id: input.fromBaseId,
  };
  const destinationSpace = {
    visibility: 'authorized' as const,
    kind: 'space' as const,
    id: input.spaceId,
  };
  const destinationBase = input.baseId
    ? { visibility: 'authorized' as const, kind: 'base' as const, id: input.baseId }
    : {
        visibility: 'redacted' as const,
        kind: 'base' as const,
        quantity: exact(1, 'bases'),
        reason: 'The destination base identity is allocated during execution',
      };
  const effects: PreviewEffect[] = [
    {
      code: 'base.duplicate.destination.placement',
      kind: 'host.effect',
      resource: destinationSpace,
      relatedResources: [sourceBase, destinationBase],
      measures: { destinationBases: exact(1, 'bases') },
    },
    {
      code: 'base.duplicate.base.copy',
      kind: 'resource.copy',
      resource: sourceBase,
      relatedResources: [destinationBase],
      measures: { bases: exact(selection.bases, 'bases') },
    },
    {
      code: 'base.duplicate.structure.selected',
      kind: 'resource.copy',
      resource: sourceBase,
      measures: {
        tables: exact(selection.tables, 'tables'),
        fields: exact(selection.fields, 'fields'),
        views: exact(selection.views, 'views'),
        nodes: exact(selection.nodes, 'nodes'),
      },
    },
    {
      code: 'base.duplicate.resources.selected',
      kind: 'resource.copy',
      resource: sourceBase,
      measures: { resources: exact(selection.resources, 'resources') },
    },
  ];

  effects.push({
    code: 'base.duplicate.trash_retention.unchanged',
    kind: 'host.effect',
    measures: { trashedResources: exact(0, 'resources') },
  });

  if (!input.withRecords) {
    effects.push(
      {
        code: 'base.duplicate.attachments.omitted',
        kind: 'host.effect',
        measures: { attachments: exact(0, 'attachments') },
      },
      {
        code: 'base.duplicate.cross_database.copy_not_applicable',
        kind: 'host.effect',
        measures: { records: exact(0, 'records') },
      }
    );
  }

  if (!input.withRecords) {
    effects.push({
      code: 'base.duplicate.records.omitted',
      kind: 'host.effect',
      resource: sourceBase,
      measures: { records: exact(0, 'records') },
    });
  } else {
    effects.push({
      code: 'base.duplicate.records.copy',
      kind: 'resource.copy',
      resource: sourceBase,
      measures: {
        records:
          records.basis === 'exact'
            ? exact(records.value, 'records')
            : unknown('records', 'Exact source row count could not be read'),
      },
    });
  }

  const linkEffects: ReadonlyArray<[number, string]> = [
    [links.sameSpacePreserved, 'base.duplicate.link.same_space_preserved'],
    [links.crossSpaceConverted, 'base.duplicate.link.cross_space_converted'],
    [links.optionDisabledConverted, 'base.duplicate.link.option_disabled_converted'],
    [links.partialSelectionDisconnected, 'base.duplicate.link.partial_selection_disconnected'],
  ];
  for (const [count, code] of linkEffects) {
    if (count === 0) continue;
    effects.push({
      code,
      kind:
        code === 'base.duplicate.link.same_space_preserved'
          ? 'dependency.change'
          : 'field.conversion',
      resource: sourceBase,
      measures: { fields: exact(count, 'fields') },
    });
  }

  return effects;
};

const unknownHostEffect = (code: string, reason: string): PreviewEffect => ({
  code,
  kind: 'host.effect',
  measures: { evidence: unknown('checks', reason) },
});

const warning = (code: string, message: string): PreviewIssue => ({ code, message });

const incompleteHostEvidence = (
  facts: DuplicateBaseV2PreviewFacts,
  resolvedConcerns: ReadonlySet<HostPreviewConcern>
): {
  effects: PreviewEffect[];
  warnings: PreviewIssue[];
  coverage: string[];
} => {
  const unknowns: ReadonlyArray<[HostPreviewConcern, string, boolean]> = [
    [
      'billing.quota',
      'Billing and quota admission is not demonstrated by the CE read-only preparation.',
      true,
    ],
    [
      'attachments',
      'Attachment copyability is checked only by host execution.',
      facts.input.withRecords,
    ],
    ['workflows', 'Workflow copy policy is not demonstrated by the CE preparation.', true],
    ['authority', 'Authority propagation is not demonstrated by the CE preparation.', true],
    ['shares', 'Share propagation is not demonstrated by the CE preparation.', true],
    [
      'app-runtime.extras',
      'App and runtime extras are restored only after target metadata exists.',
      true,
    ],
    [
      'cross-database.copy',
      'The final bulk or stream copy mode cannot be decided before target metadata exists.',
      facts.input.withRecords,
    ],
  ];
  const effects: PreviewEffect[] = [];
  const warnings: PreviewIssue[] = [];
  const coverage: string[] = [];
  for (const [concern, message, applicable] of unknowns) {
    if (resolvedConcerns.has(concern)) continue;
    if (!applicable) continue;
    const code = `base.duplicate.${concern}.unknown`;
    coverage.push(`host.${concern}`);
    effects.push(unknownHostEffect(code, message));
    warnings.push(warning(code, message));
  }
  if (facts.records.basis === 'unknown' && facts.input.withRecords) {
    const code = 'base.duplicate.records.count_unknown';
    coverage.push('records.source-row-count');
    warnings.push(
      warning(code, 'Exact source row count is unavailable; it is not treated as zero.')
    );
  }
  if (facts.links.unclassifiedExternal > 0) {
    const code = 'base.duplicate.link.external_space_unknown';
    coverage.push('links.external-space');
    warnings.push(warning(code, 'Some preserved external links could not be classified by space.'));
  }
  return { effects, warnings, coverage };
};

export class BaseDuplicatePreviewPlanner implements IHostPreviewAdapter<BaseDuplicatePreviewInput> {
  readonly operation = 'base.duplicate' as const;
  readonly concerns: ReadonlyArray<HostPreviewConcern> = hostPreviewConcernValues;
  readonly plannerVersion = 'base-duplicate-host-ce-v2';
  readonly executionPath =
    'BaseService destination engine admission/BaseDuplicateService preparation';

  constructor(
    private readonly baseDuplicateService: BaseDuplicateService,
    private readonly baseService: BaseService
  ) {}

  async preview(
    context: IExecutionContext,
    input: BaseDuplicatePreviewInput,
    _options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    let engineDecision: IV2Decision;
    try {
      // This is the normalized source/destination authorization used by the write route. It must
      // precede edition-specific policy so hidden bases cannot be distinguished by policy output.
      engineDecision = await this.baseService.previewDuplicateBaseV2(
        context,
        input.duplicateBaseRo
      );
    } catch {
      return ok({
        effects: [],
        blockers: [
          {
            code: 'base.duplicate.host_checks.blocked',
            message: 'Host authorization or destination routing guards blocked duplication.',
          },
        ],
        warnings: [],
        coverage: { known: ['host.authorization'], unknown: [] },
        complexity: null,
        authorization: 'checked',
        consistency: 'best-effort',
      });
    }

    let admission: DuplicateBaseV2HostPreviewAdmission;
    try {
      admission = await this.baseDuplicateService.previewDuplicateBaseV2Admission(
        context,
        input.duplicateBaseRo
      );
    } catch {
      return ok({
        effects: [],
        blockers: [
          {
            code: 'base.duplicate.host_admission.blocked',
            message: 'Edition authorization policy blocked duplication.',
          },
        ],
        warnings: [],
        coverage: {
          known: ['host.authorization', 'host.destination-execution-engine'],
          unknown: [],
        },
        complexity: null,
        authorization: 'checked',
        consistency: 'best-effort',
      });
    }
    if (admission.blockers.length > 0) {
      return ok({
        effects: [],
        blockers: admission.blockers,
        warnings: admission.warnings,
        coverage: {
          known: [
            'host.authorization',
            'host.destination-execution-engine',
            ...admission.knownCoverage,
          ],
          unknown: admission.unknownCoverage,
        },
        complexity: null,
        authorization: 'checked',
        consistency: 'best-effort',
      });
    }

    if (!engineDecision.useV2) {
      try {
        const legacyRouteAdmission =
          await this.baseDuplicateService.previewDuplicateBaseV1DataRoute(input.duplicateBaseRo);
        admission = {
          blockers: [...admission.blockers, ...legacyRouteAdmission.blockers],
          warnings: [...admission.warnings, ...legacyRouteAdmission.warnings],
          knownCoverage: [...admission.knownCoverage, ...legacyRouteAdmission.knownCoverage],
          unknownCoverage: [...admission.unknownCoverage, ...legacyRouteAdmission.unknownCoverage],
        };
      } catch {
        admission = {
          ...admission,
          warnings: [
            ...admission.warnings,
            {
              code: 'base.duplicate.cross_database.route_unknown',
              message: 'Legacy record-copy routing compatibility could not be established.',
            },
          ],
          unknownCoverage: [...admission.unknownCoverage, 'host.cross-database.copy'],
        };
      }
    }
    if (admission.blockers.length > 0) {
      return ok({
        effects: [],
        blockers: admission.blockers,
        warnings: admission.warnings,
        coverage: {
          known: [
            'host.authorization',
            'host.destination-execution-engine',
            ...admission.knownCoverage,
          ],
          unknown: admission.unknownCoverage,
        },
        complexity: null,
        authorization: 'checked',
        consistency: 'best-effort',
      });
    }

    let preparation: DuplicateBaseV2Preparation;
    try {
      preparation = await this.baseDuplicateService.prepareDuplicateBaseV2(input.duplicateBaseRo);
    } catch {
      return err(
        domainError.validation({
          code: 'preview.base.duplicate.preparation_failed',
          message: 'Unable to prepare a read-only base duplication preview.',
        })
      );
    }

    // Deliberately extract only public facts. Physical table names and copy
    // metadata stay in preparation.execution and never enter preview output.
    const facts = preparation.preview;
    let host: DuplicateBaseV2HostPreviewExtension;
    try {
      host = await this.baseDuplicateService.planDuplicateBaseV2Preview(context, preparation);
    } catch {
      return err(
        domainError.validation({
          code: 'preview.base.duplicate.host_preparation_failed',
          message: 'Unable to prepare host-specific base duplication evidence.',
        })
      );
    }
    const resolvedConcerns = new Set(host.resolvedConcerns);
    if (engineDecision.useV2 || admission.knownCoverage.includes('host.cross-database.copy')) {
      resolvedConcerns.add('cross-database.copy');
    }
    const incomplete = incompleteHostEvidence(facts, resolvedConcerns);
    const engineCode = engineDecision.useV2
      ? 'base.duplicate.execution.v2_selected'
      : 'base.duplicate.execution.v1_selected';
    return ok({
      effects: [
        {
          code: engineCode,
          kind: 'host.effect',
          measures: { selectedPaths: exact(1, 'execution-paths') },
        },
        ...buildResourceEffects(facts),
        ...incomplete.effects,
        ...host.effects,
      ],
      blockers: host.blockers,
      warnings: [...admission.warnings, ...incomplete.warnings, ...host.warnings],
      coverage: {
        known: [
          ...new Set([
            'host.destination.placement',
            'host.destination-execution-engine',
            'host.trash.retention',
            'host.authorization',
            'host.destination-routing',
            'base.structure',
            'base.selected-resources',
            'base.link-decisions',
            ...admission.knownCoverage,
            ...host.knownCoverage,
            ...(facts.records.basis === 'exact' ? ['records.source-row-count'] : []),
            ...(engineDecision.useV2 ? ['host.cross-database.copy'] : []),
            ...(!facts.input.withRecords ? ['host.attachments', 'host.cross-database.copy'] : []),
          ]),
        ],
        unknown: [
          ...new Set([
            ...admission.unknownCoverage,
            ...incomplete.coverage,
            ...host.unknownCoverage,
          ]),
        ],
      },
      complexity: null,
      authorization: 'checked',
      consistency: 'best-effort',
    });
  }
}

export const createBaseDuplicatePreviewRegistration = (
  planner: BaseDuplicatePreviewPlanner,
  priority: number = 0
): HostPreviewRegistration<BaseDuplicatePreviewInput> => ({
  operation: 'base.duplicate',
  parseInput: parseBaseDuplicatePreviewInput,
  planner,
  priority,
  capability: {
    canonicalWriteRoute: 'POST /base/duplicate',
    supportLevel: 'partial',
    requiredPermissionScope: 'target base|create; source base|update',
    detailLevels: ['summary', 'full'],
    limitations: [
      'The destination-space canary decision selects the same legacy or v2 engine as the write route.',
      'Legacy cross-database record-copy compatibility is reported only when ready routing metadata proves it.',
      'Attachment, workflow, authority, share, app/runtime, billing/quota, and cross-database copy evidence may remain unknown.',
      'Physical bulk-versus-stream copy mode is decided only after target metadata exists.',
    ],
  },
});

@V2ProjectionRegistrar()
@Injectable()
export class BaseDuplicatePreviewRegistrar implements IV2ProjectionRegistrar {
  constructor(
    private readonly baseDuplicateService: BaseDuplicateService,
    private readonly baseService: BaseService
  ) {}

  registerProjections(container: DependencyContainer): void {
    const registry = container.resolve<PreviewPlannerRegistry>(
      v2CommandExplainTokens.previewPlannerRegistry
    );
    const result = registry.registerHost(
      createBaseDuplicatePreviewRegistration(
        new BaseDuplicatePreviewPlanner(this.baseDuplicateService, this.baseService)
      )
    );
    if (result.isErr()) throw new Error(result.error.message);
  }
}
