import type { IOperationPreviewDto } from '@teable/v2-contract-http/operationPreview';

type PreviewEffect = IOperationPreviewDto['effects'][number];
export type PreviewMeasure = PreviewEffect['measures'][string];
type PreviewResource = NonNullable<PreviewEffect['resource']>;

// Only decision-relevant consequences belong in a confirmation; diagnostics stay in the DTO.
const consequenceMessages = {
  'field.delete.target': 'fieldDeleted',
  'field.delete.symmetric_link_removed': 'symmetricLinkRemovedDetail',
  'field.delete.dependent_field_changed': 'fieldDependenciesChangedDetail',
  'field.delete.view_changed': 'fieldViewsChangedDetail',
  'table.delete.inbound_link.converted_to_text': 'linksConvertedDetail',
  'table.delete.dependent_field.marked_error': 'dependentFieldsError',
  'table.delete.dependent_field.updated': 'dependentFieldsUpdatedDetail',
  'base.duplicate.link.cross_space_converted': 'crossSpaceConvertedDetail',
  'base.duplicate.link.option_disabled_converted': 'copyLinksConverted',
  'base.duplicate.link.partial_selection_disconnected': 'linksDisconnectedDetail',
  'base.duplicate.link.same_space_preserved': 'linksPreservedDetail',
} as const;

const blockerMessages = {
  'table.duplicate.v2_cross_space_blocked': 'crossSpaceBlocked',
  'table.duplicate.host_policy_blocked': 'destinationBlocked',
  'base.duplicate.host_checks.blocked': 'destinationBlocked',
  'base.duplicate.host_admission.blocked': 'destinationBlocked',
  'base.duplicate.authority.restricted': 'restrictedCopy',
  'base.duplicate.v1.cross_database_records_blocked': 'crossDatabaseRecordsBlocked',
  'forbidden.table.delete_primary_field': 'primaryFieldBlocked',
} as const;

const warningMessages = {
  'field.delete.foreign_metadata_missing': 'fieldMetadataMissingDetail',
  'table.delete.already_trashed': 'alreadyTrashed',
  'base.duplicate.link.external_space_unknown': 'unknownLinksDetail',
  'table.delete.effects_truncated': 'truncatedEffectsDetail',
  'preview.items_truncated': 'truncatedEffectsDetail',
  'table.duplicate.preview_items_truncated': 'truncatedEffectsDetail',
  'records.bulkUpdate.effects_truncated': 'truncatedEffectsDetail',
} as const;

type BlockerMessage = (typeof blockerMessages)[keyof typeof blockerMessages] | 'genericBlocked';
type WarningMessage = (typeof warningMessages)[keyof typeof warningMessages];
type ConsequenceMessage =
  | (typeof consequenceMessages)[keyof typeof consequenceMessages]
  | 'selfLinksRemapped';
type CoverageMessage =
  | 'resourceCoverageUnknown'
  | 'executionCoverageUnknown'
  | 'retentionUnknown'
  | 'storageUnknown'
  | 'recordCountUnknown'
  | 'uncertaintyDetail';

export interface CopySummary {
  heading: 'copyStructureOnlyDetail' | 'copyWithRecordsDetail' | 'copyStructureDetail';
  names: string[];
  quantities: { label: 'tables' | 'fields' | 'views' | 'records'; measure: PreviewMeasure }[];
}

export interface DeleteSummary {
  message: 'moveToTrash' | 'permanentDelete';
  names: string[];
}

export interface ConsequenceSummary {
  key: string;
  message: ConsequenceMessage;
  names: string[];
  tables: string[];
  fields?: PreviewMeasure;
  views?: PreviewMeasure;
  hidden: boolean;
  preserved: boolean;
}

export interface PreviewPresentation {
  copy?: CopySummary;
  deletion?: DeleteSummary;
  blockers: { message: BlockerMessage; names: string[] }[];
  warnings: WarningMessage[];
  consequences: ConsequenceSummary[];
  hiddenDependencies: boolean;
  coverage: CoverageMessage[];
}

const authorizedNames = (resources: ReadonlyArray<PreviewResource | undefined>) => [
  ...new Set(
    resources.flatMap((resource) =>
      resource?.visibility === 'authorized' && resource.name?.trim() ? [resource.name] : []
    )
  ),
];

const effectNames = (effect: PreviewEffect) =>
  authorizedNames([effect.resource, ...(effect.relatedResources ?? [])]);

const copyQuantities = (
  structure: PreviewEffect | undefined,
  records: PreviewEffect | undefined,
  structureOnly: boolean,
  isTable: boolean
): CopySummary['quantities'] => {
  const quantities: CopySummary['quantities'] = [];
  for (const label of ['tables', 'fields', 'views', 'records'] as const) {
    if ((label === 'tables' && isTable) || (label === 'records' && structureOnly)) continue;
    const measure = label === 'records' ? records?.measures.records : structure?.measures[label];
    if (measure) quantities.push({ label, measure });
    else if (label === 'records' && records) {
      quantities.push({
        label,
        measure: { basis: 'unknown', unit: 'records', reason: 'count-unavailable' },
      });
    }
  }
  return quantities;
};

const copySummary = (preview: IOperationPreviewDto): CopySummary | undefined => {
  const prefix = preview.operation;
  if (!['base.duplicate', 'table.duplicate'].includes(prefix)) return;
  const structure = preview.effects.find(
    (effect) =>
      effect.code === `${prefix}.structure.${prefix === 'base.duplicate' ? 'selected' : 'copy'}`
  );
  const records = preview.effects.find((effect) => effect.code === `${prefix}.records.copy`);
  const structureOnly = preview.effects.some(
    (effect) => effect.code === `${prefix}.records.omitted`
  );
  if (!structure && !records && !structureOnly) return;
  const quantities = copyQuantities(
    structure,
    records,
    structureOnly,
    prefix === 'table.duplicate'
  );
  return {
    heading: structureOnly
      ? 'copyStructureOnlyDetail'
      : records
        ? 'copyWithRecordsDetail'
        : 'copyStructureDetail',
    names: structure ? authorizedNames([structure.resource]) : [],
    quantities,
  };
};

const deleteSummary = (preview: IOperationPreviewDto): DeleteSummary | undefined => {
  if (preview.operation !== 'table.delete') return;
  const deletion = preview.effects.find(
    (effect) =>
      effect.code === 'table.delete.resource.trashed' ||
      effect.code === 'table.delete.resource.permanently_deleted'
  );
  if (!deletion) return;
  return {
    message: deletion.code === 'table.delete.resource.trashed' ? 'moveToTrash' : 'permanentDelete',
    names: effectNames(deletion),
  };
};

const blockerSummary = (preview: IOperationPreviewDto): PreviewPresentation['blockers'] => {
  const blockers: PreviewPresentation['blockers'] = [];
  for (const issue of preview.blockers) {
    const message = Object.hasOwn(blockerMessages, issue.code)
      ? blockerMessages[issue.code as keyof typeof blockerMessages]
      : 'genericBlocked';
    const names = authorizedNames([issue.resource]);
    if (issue.code === 'table.duplicate.v2_cross_space_blocked') {
      names.push(
        ...preview.effects
          .filter((effect) => effect.code === 'table.duplicate.link.cross_space_blocked')
          .flatMap(effectNames)
      );
    }
    const existing = blockers.find((blocker) => blocker.message === message);
    if (existing) existing.names = [...new Set([...existing.names, ...names])];
    else blockers.push({ message, names: [...new Set(names)] });
  }
  if (preview.outcome === 'blocked' && blockers.length === 0) {
    blockers.push({ message: 'genericBlocked', names: [] });
  }
  return blockers;
};

const describeConsequence = (effect: PreviewEffect): ConsequenceSummary => {
  const related = effect.relatedResources ?? [];
  const hidden = [effect.resource, ...related].some(
    (resource) => resource?.visibility === 'redacted'
  );
  const names = authorizedNames([
    effect.resource?.kind === 'field' || effect.resource?.kind === 'view'
      ? effect.resource
      : undefined,
    ...related.filter((resource) => resource.kind === 'field' || resource.kind === 'view'),
  ]);
  const tables = authorizedNames(related.filter((resource) => resource.kind === 'table'));
  return {
    key: JSON.stringify([effect.code, tables]),
    message: consequenceMessages[effect.code as keyof typeof consequenceMessages],
    names,
    tables,
    fields: !hidden ? effect.measures.fields : undefined,
    views: !hidden ? effect.measures.views : undefined,
    hidden,
    preserved: effect.code === 'base.duplicate.link.same_space_preserved',
  };
};

const mergeConsequence = (existing: ConsequenceSummary, next: ConsequenceSummary) => {
  existing.names = [...new Set([...existing.names, ...next.names])];
  existing.hidden ||= next.hidden;
  for (const label of ['fields', 'views'] as const) {
    const current = existing[label];
    const incoming = next[label];
    existing[label] = existing.hidden
      ? undefined
      : current?.basis === 'exact' && incoming?.basis === 'exact'
        ? { ...current, value: current.value + incoming.value }
        : current || incoming
          ? { basis: 'unknown', unit: label, reason: 'aggregate-count-unavailable' }
          : undefined;
  }
};

const tableLinkConsequences = (preview: IOperationPreviewDto): ConsequenceSummary[] => {
  if (preview.operation !== 'table.duplicate') return [];
  const classification = preview.effects.find(
    (effect) => effect.code === 'table.duplicate.link_references.classify'
  );
  const consequences: ConsequenceSummary[] = [];
  for (const [measure, message, preserved] of [
    ['externalLinksPreserved', 'linksPreservedDetail', true],
    ['selfLinksRemapped', 'selfLinksRemapped', false],
  ] as const) {
    const fields = classification?.measures[measure];
    if (fields?.basis !== 'exact' || fields.value <= 0) continue;
    consequences.push({
      key: measure,
      message,
      names: [],
      tables: [],
      fields,
      hidden: false,
      preserved,
    });
  }
  return consequences;
};

const consequenceSummary = (preview: IOperationPreviewDto): ConsequenceSummary[] => {
  const consequences: ConsequenceSummary[] = [];
  const groups = new Map<string, ConsequenceSummary>();
  for (const effect of preview.effects) {
    if (!Object.hasOwn(consequenceMessages, effect.code)) continue;
    const consequence = describeConsequence(effect);
    // Keep each owning table attached to its fields without repeating hidden effects.
    const existing = groups.get(consequence.key);
    if (existing) {
      mergeConsequence(existing, consequence);
      continue;
    }
    groups.set(consequence.key, consequence);
    consequences.push(consequence);
  }
  return [...consequences, ...tableLinkConsequences(preview)];
};

const coverageMessages: Record<string, CoverageMessage> = {
  'inbound-reference-metadata': 'resourceCoverageUnknown',
  'inbound-link-downstream-cascades': 'resourceCoverageUnknown',
  'cross-table effects for missing foreign table metadata': 'resourceCoverageUnknown',
  'dependent-resource-authorization': 'resourceCoverageUnknown',
  'redacted-dependent-resource-cardinality': 'resourceCoverageUnknown',
  'resource authorization and identity visibility': 'resourceCoverageUnknown',
  'redacted resource identities and cardinalities': 'resourceCoverageUnknown',
  'host.trash-retention': 'retentionUnknown',
  'host.usage-effects': 'storageUnknown',
  'field-operation execution plugins': 'executionCoverageUnknown',
  'host external hooks': 'executionCoverageUnknown',
  'host authorization and external hooks': 'executionCoverageUnknown',
  'table-operation-policy': 'executionCoverageUnknown',
  'cross-space-reference-policy': 'executionCoverageUnknown',
  'source-record-count': 'recordCountUnknown',
  'records.source-row-count': 'recordCountUnknown',
  'final-record-copy-path': 'executionCoverageUnknown',
  'hydrated-record-write-policy': 'executionCoverageUnknown',
  'links.external-space': 'resourceCoverageUnknown',
  'host.billing.quota': 'executionCoverageUnknown',
  'host.attachments': 'executionCoverageUnknown',
  'host.workflows': 'executionCoverageUnknown',
  'host.authority': 'executionCoverageUnknown',
  'host.shares': 'executionCoverageUnknown',
  'host.app-runtime.extras': 'executionCoverageUnknown',
  'host.cross-database.copy': 'executionCoverageUnknown',
};

const hasDedicatedCoverageNote = (
  preview: IOperationPreviewDto,
  item: string,
  message: CoverageMessage
): boolean => {
  if (message === 'recordCountUnknown') {
    return preview.effects.some((effect) => effect.code === `${preview.operation}.records.copy`);
  }
  if (item === 'cross-table effects for missing foreign table metadata') {
    return preview.warnings.some((issue) => issue.code === 'field.delete.foreign_metadata_missing');
  }
  if (item === 'links.external-space') {
    return preview.warnings.some(
      (issue) => issue.code === 'base.duplicate.link.external_space_unknown'
    );
  }
  return false;
};

const coverageSummary = (preview: IOperationPreviewDto): CoverageMessage[] => {
  const messages = new Set<CoverageMessage>();
  const permanent = preview.effects.some(
    (effect) => effect.code === 'table.delete.resource.permanently_deleted'
  );
  for (const item of preview.coverage.unknown) {
    const message = Object.hasOwn(coverageMessages, item)
      ? coverageMessages[item]
      : 'uncertaintyDetail';
    if (message === 'retentionUnknown' && permanent) continue;
    if (hasDedicatedCoverageNote(preview, item, message)) continue;
    messages.add(message);
  }
  if (
    preview.warnings.some((issue) => !Object.hasOwn(warningMessages, issue.code)) &&
    messages.size === 0
  ) {
    messages.add('uncertaintyDetail');
  }
  if (
    preview.outcome === 'incomplete' &&
    preview.coverage.unknown.length === 0 &&
    messages.size === 0 &&
    preview.warnings.length === 0
  ) {
    messages.add('uncertaintyDetail');
  }
  return [...messages];
};

export const buildPreviewPresentation = (preview: IOperationPreviewDto): PreviewPresentation => {
  const consequences = consequenceSummary(preview);
  const deletion = deleteSummary(preview);
  const hiddenDependencies = preview.effects.some(
    (effect) =>
      effect.code === 'table.delete.dependent_resources.redacted' ||
      (effect.code !== 'field.delete.target' &&
        Object.hasOwn(consequenceMessages, effect.code) &&
        [effect.resource, ...(effect.relatedResources ?? [])].some(
          (resource) => resource?.visibility === 'redacted'
        ))
  );
  const warnings = [
    ...new Set(
      preview.warnings.flatMap((issue) => {
        const message = Object.hasOwn(warningMessages, issue.code)
          ? warningMessages[issue.code as keyof typeof warningMessages]
          : undefined;
        return message ? [message] : [];
      })
    ),
  ];
  return {
    copy: copySummary(preview),
    deletion,
    consequences,
    warnings,
    hiddenDependencies,
    blockers: blockerSummary(preview),
    coverage: coverageSummary(preview),
  };
};
