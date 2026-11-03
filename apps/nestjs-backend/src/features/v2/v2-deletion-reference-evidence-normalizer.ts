import { Injectable } from '@nestjs/common';
import type { IFieldDeleteReferencesVo, ITableDeleteReferencesVo } from '@teable/openapi';
import type {
  PreviewEffect,
  PreviewIssue,
  PreviewResourceKind,
  PreviewResourceReference,
} from '@teable/v2-command-explain';
import type { IExecutionContext } from '@teable/v2-core';

export const HOST_DELETION_REFERENCE_REDACTION_REASON = 'resource-not-authorized';

export const hostDeletionReferenceEvidenceCodes = {
  effect: {
    fieldDeleteField: 'host.field-delete.reference.field',
    fieldDeleteView: 'host.field-delete.reference.view',
    fieldDeleteWorkflow: 'host.field-delete.reference.workflow',
    fieldDeleteAuthorityRole: 'host.field-delete.reference.authority-role',
    tableDeleteField: 'host.table-delete.reference.field',
  },
  warning: {
    collectionUnavailable: 'host.deletion-reference.collection-unavailable',
    collectionNonExhaustive: 'host.deletion-reference.collection-non-exhaustive',
    authorizationUnavailable: 'host.deletion-reference.authorization-unavailable',
    resourcesRedacted: 'host.deletion-reference.resources-redacted',
  },
  coverage: {
    fieldReferences: 'host.field-delete.references',
    fieldReferencesCollected: 'host.field-delete.references.collected',
    fieldReferencesExhaustiveness: 'host.field-delete.references.exhaustiveness',
    tableReferences: 'host.table-delete.references',
    tableReferencesCollected: 'host.table-delete.references.collected',
    tableReferencesExhaustiveness: 'host.table-delete.references.exhaustiveness',
    authorization: 'host.deletion-reference.authorization',
  },
} as const;

export type HostDeletionReferenceOwner =
  | {
      readonly kind: 'base';
      readonly baseId: string;
    }
  | {
      readonly kind: 'table';
      readonly baseId: string;
      readonly tableId: string;
    }
  | {
      readonly kind: 'workflow';
      readonly baseId: string;
      readonly workflowId: string;
    };

/**
 * Caller-scoped authorization seam. Implementations must decide disclosure for the supplied
 * request context; they must not retain request-local authorization state in singleton fields.
 */
export interface IHostDeletionReferenceAuthorization {
  canDiscloseOwner(
    context: IExecutionContext,
    owner: HostDeletionReferenceOwner
  ): boolean | Promise<boolean>;
}

/**
 * The legacy collectors can omit unresolved metadata and execution-only dependencies.
 * Their successful DTOs must therefore use exhaustive: false unless the caller has
 * independently established complete collection. Unavailability never means zero impact.
 */
export type HostDeletionReferenceCollection<T> =
  | {
      readonly availability: 'available';
      readonly value: T;
      readonly exhaustive: boolean;
    }
  | {
      readonly availability: 'unavailable';
    };

export type HostDeletionReferenceEvidence = {
  readonly effects: ReadonlyArray<PreviewEffect>;
  readonly warnings: ReadonlyArray<PreviewIssue>;
  readonly coverage: {
    readonly known: ReadonlyArray<string>;
    readonly unknown: ReadonlyArray<string>;
  };
};

export type NormalizeFieldDeletionReferencesInput = {
  readonly context: IExecutionContext;
  readonly authorization: IHostDeletionReferenceAuthorization;
  readonly target: {
    readonly baseId: string;
    readonly tableId: string;
  };
  readonly collection: HostDeletionReferenceCollection<IFieldDeleteReferencesVo>;
};

export type NormalizeTableDeletionReferencesInput = {
  readonly context: IExecutionContext;
  readonly authorization: IHostDeletionReferenceAuthorization;
  readonly collection: HostDeletionReferenceCollection<ITableDeleteReferencesVo>;
};

type EvidenceKind = Extract<PreviewResourceKind, 'field' | 'view' | 'workflow' | 'host'>;

type InternalCandidate = {
  readonly kind: EvidenceKind;
  readonly id: string;
  readonly name?: string;
  readonly owner: HostDeletionReferenceOwner;
};

type OperationEvidenceDefinition = {
  readonly completeCoverage: string;
  readonly collectedCoverage: string;
  readonly exhaustivenessCoverage: string;
  readonly effectCode: Readonly<Record<EvidenceKind, string | undefined>>;
};

const fieldEvidenceDefinition: OperationEvidenceDefinition = {
  completeCoverage: hostDeletionReferenceEvidenceCodes.coverage.fieldReferences,
  collectedCoverage: hostDeletionReferenceEvidenceCodes.coverage.fieldReferencesCollected,
  exhaustivenessCoverage: hostDeletionReferenceEvidenceCodes.coverage.fieldReferencesExhaustiveness,
  effectCode: {
    field: hostDeletionReferenceEvidenceCodes.effect.fieldDeleteField,
    view: hostDeletionReferenceEvidenceCodes.effect.fieldDeleteView,
    workflow: hostDeletionReferenceEvidenceCodes.effect.fieldDeleteWorkflow,
    host: hostDeletionReferenceEvidenceCodes.effect.fieldDeleteAuthorityRole,
  },
};

const tableEvidenceDefinition: OperationEvidenceDefinition = {
  completeCoverage: hostDeletionReferenceEvidenceCodes.coverage.tableReferences,
  collectedCoverage: hostDeletionReferenceEvidenceCodes.coverage.tableReferencesCollected,
  exhaustivenessCoverage: hostDeletionReferenceEvidenceCodes.coverage.tableReferencesExhaustiveness,
  effectCode: {
    field: hostDeletionReferenceEvidenceCodes.effect.tableDeleteField,
    view: undefined,
    workflow: undefined,
    host: undefined,
  },
};

const evidenceKindOrder: ReadonlyArray<EvidenceKind> = ['field', 'view', 'workflow', 'host'];

const ownerKey = (owner: HostDeletionReferenceOwner): string => {
  if (owner.kind === 'base') return `base:${owner.baseId}`;
  if (owner.kind === 'workflow') return `workflow:${owner.baseId}:${owner.workflowId}`;
  return `table:${owner.baseId}:${owner.tableId}`;
};

const candidateKey = (candidate: InternalCandidate): string => `${candidate.kind}:${candidate.id}`;

const redactedReference = (kind: EvidenceKind): PreviewResourceReference => ({
  visibility: 'redacted',
  kind,
  quantity: {
    basis: 'unknown',
    unit: kind,
    reason: HOST_DELETION_REFERENCE_REDACTION_REASON,
  },
  reason: HOST_DELETION_REFERENCE_REDACTION_REASON,
});

const authorizedReference = (candidate: InternalCandidate): PreviewResourceReference => ({
  visibility: 'authorized',
  kind: candidate.kind,
  id: candidate.id,
  ...(candidate.name ? { name: candidate.name } : {}),
});

const fieldCandidates = (
  references: IFieldDeleteReferencesVo,
  target: NormalizeFieldDeletionReferencesInput['target']
): ReadonlyArray<InternalCandidate> => {
  const candidates: InternalCandidate[] = [];
  const targetOwner: HostDeletionReferenceOwner = { kind: 'base', baseId: target.baseId };

  for (const item of Object.values(references)) {
    for (const field of item.dependentFields) {
      candidates.push({
        kind: 'field',
        id: field.id,
        name: field.name,
        owner: {
          kind: 'table',
          baseId: field.source.base.id,
          tableId: field.source.id,
        },
      });
    }
    for (const view of item.views) {
      candidates.push({
        kind: 'view',
        id: view.id,
        name: view.name,
        owner: {
          kind: 'table',
          baseId: view.source.base.id,
          tableId: view.source.id,
        },
      });
    }
    for (const workflowNode of item.workflowNodes) {
      candidates.push({
        kind: 'workflow',
        id: workflowNode.source.id,
        name: workflowNode.source.name,
        owner: {
          kind: 'workflow',
          baseId: workflowNode.source.base.id,
          workflowId: workflowNode.source.id,
        },
      });
    }
    for (const role of item.authorityMatrixRoles) {
      candidates.push({
        kind: 'host',
        id: role.id,
        name: role.name,
        owner: targetOwner,
      });
    }
  }

  return candidates;
};

const tableCandidates = (references: ITableDeleteReferencesVo): ReadonlyArray<InternalCandidate> =>
  references.dependentFields.map((field) => ({
    kind: 'field',
    id: field.id,
    name: field.name,
    owner: {
      kind: 'table',
      baseId: field.source.base.id,
      tableId: field.source.id,
    },
  }));

const unavailableEvidence = (
  definition: OperationEvidenceDefinition
): HostDeletionReferenceEvidence => ({
  effects: [],
  warnings: [{ code: hostDeletionReferenceEvidenceCodes.warning.collectionUnavailable }],
  coverage: { known: [], unknown: [definition.completeCoverage] },
});

type GroupedCandidates = {
  readonly byIdentity: ReadonlyMap<
    string,
    { readonly candidate: InternalCandidate; readonly ownerKeys: Set<string> }
  >;
  readonly owners: ReadonlyMap<string, HostDeletionReferenceOwner>;
};

type DisclosedCandidates = {
  readonly referencesByKind: ReadonlyMap<EvidenceKind, ReadonlyArray<PreviewResourceReference>>;
  readonly redactedKinds: ReadonlySet<EvidenceKind>;
};

const compareCandidates = (left: InternalCandidate, right: InternalCandidate): number => {
  const identityOrder = candidateKey(left).localeCompare(candidateKey(right));
  if (identityOrder !== 0) return identityOrder;
  const nameOrder = (left.name ?? '').localeCompare(right.name ?? '');
  if (nameOrder !== 0) return nameOrder;
  return ownerKey(left.owner).localeCompare(ownerKey(right.owner));
};

const groupCandidates = (candidates: ReadonlyArray<InternalCandidate>): GroupedCandidates => {
  const byIdentity = new Map<string, { candidate: InternalCandidate; ownerKeys: Set<string> }>();
  const owners = new Map<string, HostDeletionReferenceOwner>();

  for (const candidate of [...candidates].sort(compareCandidates)) {
    const ownershipKey = ownerKey(candidate.owner);
    owners.set(ownershipKey, candidate.owner);
    const identityKey = candidateKey(candidate);
    const existing = byIdentity.get(identityKey);
    if (existing) {
      existing.ownerKeys.add(ownershipKey);
      continue;
    }
    byIdentity.set(identityKey, {
      candidate,
      ownerKeys: new Set([ownershipKey]),
    });
  }

  return { byIdentity, owners };
};

/** Authorization failures are disclosed as an incomplete preview, never as zero impact. */
const resolveOwnerDisclosure = async (
  context: IExecutionContext,
  authorization: IHostDeletionReferenceAuthorization,
  owners: ReadonlyMap<string, HostDeletionReferenceOwner>
): Promise<{
  readonly disclosureByOwner: ReadonlyMap<string, boolean>;
  readonly authorizationUnavailable: boolean;
}> => {
  const disclosureByOwner = new Map<string, boolean>();
  let authorizationUnavailable = false;

  for (const ownershipKey of [...owners.keys()].sort()) {
    try {
      disclosureByOwner.set(
        ownershipKey,
        await authorization.canDiscloseOwner(context, owners.get(ownershipKey)!)
      );
    } catch {
      authorizationUnavailable = true;
      disclosureByOwner.set(ownershipKey, false);
    }
  }

  return { disclosureByOwner, authorizationUnavailable };
};

const partitionByDisclosure = (
  grouped: GroupedCandidates,
  disclosureByOwner: ReadonlyMap<string, boolean>
): DisclosedCandidates => {
  const referencesByKind = new Map<EvidenceKind, PreviewResourceReference[]>();
  const redactedKinds = new Set<EvidenceKind>();
  const identities = [...grouped.byIdentity.values()].sort((left, right) =>
    candidateKey(left.candidate).localeCompare(candidateKey(right.candidate))
  );

  for (const identity of identities) {
    const disclosed = [...identity.ownerKeys].every(
      (ownershipKey) => disclosureByOwner.get(ownershipKey) === true
    );
    if (!disclosed) {
      redactedKinds.add(identity.candidate.kind);
      continue;
    }
    const references = referencesByKind.get(identity.candidate.kind) ?? [];
    references.push(authorizedReference(identity.candidate));
    referencesByKind.set(identity.candidate.kind, references);
  }

  return { referencesByKind, redactedKinds };
};

const buildReferenceEffects = (
  disclosed: DisclosedCandidates,
  definition: OperationEvidenceDefinition
): PreviewEffect[] => {
  const effects: PreviewEffect[] = [];

  for (const kind of evidenceKindOrder) {
    const authorized = disclosed.referencesByKind.get(kind) ?? [];
    const hasRedacted = disclosed.redactedKinds.has(kind);
    if (authorized.length === 0 && !hasRedacted) continue;
    const code = definition.effectCode[kind];
    if (!code) continue;
    const relatedResources = hasRedacted ? [...authorized, redactedReference(kind)] : authorized;
    effects.push({
      code,
      kind: 'dependency.change',
      relatedResources,
      measures: {
        references: hasRedacted
          ? {
              basis: 'unknown',
              unit: kind,
              reason: HOST_DELETION_REFERENCE_REDACTION_REASON,
            }
          : { basis: 'exact', value: authorized.length, unit: kind },
      },
    });
  }

  return effects;
};

const buildReferenceWarnings = (
  exhaustive: boolean,
  authorizationUnavailable: boolean,
  redactedKinds: ReadonlySet<EvidenceKind>
): PreviewIssue[] => {
  const warnings: PreviewIssue[] = [];
  if (!exhaustive) {
    warnings.push({ code: hostDeletionReferenceEvidenceCodes.warning.collectionNonExhaustive });
  }
  if (authorizationUnavailable) {
    warnings.push({ code: hostDeletionReferenceEvidenceCodes.warning.authorizationUnavailable });
  }
  if (redactedKinds.size > 0) {
    warnings.push({ code: hostDeletionReferenceEvidenceCodes.warning.resourcesRedacted });
  }
  return warnings;
};

const buildReferenceCoverage = (
  exhaustive: boolean,
  authorizationUnavailable: boolean,
  definition: OperationEvidenceDefinition
): HostDeletionReferenceEvidence['coverage'] => {
  const known = exhaustive ? [definition.completeCoverage] : [definition.collectedCoverage];
  const unknown = exhaustive ? [] : [definition.exhaustivenessCoverage];
  if (authorizationUnavailable) {
    unknown.push(hostDeletionReferenceEvidenceCodes.coverage.authorization);
  }
  return { known, unknown };
};

/**
 * Read-only disclosure projection, not a deletion planner. Only explicit identity fields
 * reach canonical evidence; source ancestry, collector configuration and failures do not.
 * Context, authorization and its owner-decision cache are confined to each call.
 */
@Injectable()
export class V2DeletionReferenceEvidenceNormalizer {
  async normalizeFieldReferences(
    input: NormalizeFieldDeletionReferencesInput
  ): Promise<HostDeletionReferenceEvidence> {
    if (input.collection.availability === 'unavailable') {
      return unavailableEvidence(fieldEvidenceDefinition);
    }

    return this.normalizeAvailable(
      input.context,
      input.authorization,
      fieldCandidates(input.collection.value, input.target),
      input.collection.exhaustive,
      fieldEvidenceDefinition
    );
  }

  async normalizeTableReferences(
    input: NormalizeTableDeletionReferencesInput
  ): Promise<HostDeletionReferenceEvidence> {
    if (input.collection.availability === 'unavailable') {
      return unavailableEvidence(tableEvidenceDefinition);
    }

    return this.normalizeAvailable(
      input.context,
      input.authorization,
      tableCandidates(input.collection.value),
      input.collection.exhaustive,
      tableEvidenceDefinition
    );
  }

  private async normalizeAvailable(
    context: IExecutionContext,
    authorization: IHostDeletionReferenceAuthorization,
    candidates: ReadonlyArray<InternalCandidate>,
    exhaustive: boolean,
    definition: OperationEvidenceDefinition
  ): Promise<HostDeletionReferenceEvidence> {
    const grouped = groupCandidates(candidates);
    const disclosures = await resolveOwnerDisclosure(context, authorization, grouped.owners);
    const disclosed = partitionByDisclosure(grouped, disclosures.disclosureByOwner);

    return {
      effects: buildReferenceEffects(disclosed, definition),
      warnings: buildReferenceWarnings(
        exhaustive,
        disclosures.authorizationUnavailable,
        disclosed.redactedKinds
      ),
      coverage: buildReferenceCoverage(
        exhaustive,
        disclosures.authorizationUnavailable,
        definition
      ),
    };
  }
}
