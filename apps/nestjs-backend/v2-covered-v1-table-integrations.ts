import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep this list limited to pure v1 table/data-engine suites with explicit v2 coverage.
// Mixed host-integration and v2-canary files must remain outside the retirement manifest.

type V1TableIntegrationRetirement = {
  domain: string;
  sources: readonly string[];
  v2Coverage: readonly string[];
};

const retirements = [
  {
    domain: 'aggregation, grouping, filtering and sorting',
    sources: [
      'aggregation-search-count-question-mark.e2e-spec.ts',
      'aggregation-search.e2e-spec.ts',
      'aggregation.e2e-spec.ts',
      'comprehensive-aggregation.e2e-spec.ts',
      'comprehensive-field-filter.e2e-spec.ts',
      'comprehensive-field-sort.e2e-spec.ts',
      'group.e2e-spec.ts',
      'sort.e2e-spec.ts',
    ],
    v2Coverage: [
      'aggregate-records.e2e.spec.ts',
      'listRecords-group.e2e.spec.ts',
      'listRecords-operator-matrix.e2e.spec.ts',
      'listRecords-search.e2e.spec.ts',
      'listRecords-sort.e2e.spec.ts',
    ],
  },
  {
    domain: 'record persistence and query behavior',
    sources: [
      'auto-number.e2e-spec.ts',
      'order-update.e2e-spec.ts',
      'record-bulk-delete.e2e-spec.ts',
      'record-delete-link-cleanup.e2e-spec.ts',
      'record-field-key.e2e-spec.ts',
      'record-filter-lookup-number-param.e2e-spec.ts',
      'record-filter-lookup-string-question-mark.e2e-spec.ts',
      'record-filter-query-issues.e2e-spec.ts',
      'record-filter-query.e2e-spec.ts',
      'record-group-datetime-timezone.e2e-spec.ts',
      'record-link-select-query.e2e-spec.ts',
      'record-query-builder.e2e-spec.ts',
      'record-search-query.e2e-spec.ts',
      'record-search-question-mark.e2e-spec.ts',
      'record-typecast.e2e-spec.ts',
      'record-unary-filter.e2e-spec.ts',
      'search-consistency.e2e-spec.ts',
    ],
    v2Coverage: [
      'auto-number.e2e.spec.ts',
      'createRecord.e2e.spec.ts',
      'createRecords.e2e.spec.ts',
      'deleteByRange.e2e.spec.ts',
      'deleteRecords.e2e.spec.ts',
      'listRecords-operator-matrix.e2e.spec.ts',
      'listRecords-search.e2e.spec.ts',
      'listRecords-sort.e2e.spec.ts',
      'listRecords-unary-filter.e2e.spec.ts',
      'record-field-key.e2e.spec.ts',
      'updateRecord.e2e.spec.ts',
      'updateRecords.e2e.spec.ts',
    ],
  },
  {
    domain: 'field lifecycle and constraints',
    sources: [
      'convert-field-transaction.e2e-spec.ts',
      'delete-field.e2e-spec.ts',
      'duplicate-field-transaction.e2e-spec.ts',
      'field-calculation.e2e-spec.ts',
      'field-converting.e2e-spec.ts',
      'field-delete-references.e2e-spec.ts',
      'field-duplicate.e2e-spec.ts',
      'field-filter-options-persist.e2e-spec.ts',
      'field-physical-columns.e2e-spec.ts',
      'field-reference.e2e-spec.ts',
      'field-view-sync.e2e-spec.ts',
      'lin-field-not-null.e2e-spec.ts',
      'not-null-validation.e2e-spec.ts',
      'number-precision.e2e-spec.ts',
    ],
    v2Coverage: [
      'createField.e2e.spec.ts',
      'deleteField.e2e.spec.ts',
      'duplicateField.e2e.spec.ts',
      'record-constraint-violations.e2e.spec.ts',
      'update-field/singleLineText/constraint-validation.spec.ts',
    ],
  },
  {
    domain: 'link, lookup, conditional and rollup behavior',
    sources: [
      'basic-link.e2e-spec.ts',
      'bidirectional-formula-link.e2e-spec.ts',
      'conditional-lookup.e2e-spec.ts',
      'conditional-rollup.e2e-spec.ts',
      'link-api.e2e-spec.ts',
      'link-bulk-conversion.e2e-spec.ts',
      'link-field-null-handling.e2e-spec.ts',
      'link-formula-if-boolean-context.e2e-spec.ts',
      'link-formula-recursion.e2e-spec.ts',
      'link-id-only-title-regression.e2e-spec.ts',
      'link-multi-config-toggle.e2e-spec.ts',
      'link-view-user-filter.e2e-spec.ts',
      'lookup-cross-base-tiering.e2e-spec.ts',
      'lookup-nested-link-lookup.e2e-spec.ts',
      'lookup-to-link.e2e-spec.ts',
      'lookup.e2e-spec.ts',
      'nested-lookup-formula.e2e-spec.ts',
      'nested-lookup.e2e-spec.ts',
      'one-many-formula-symmetric-link.e2e-spec.ts',
      'opportunity-rollup-regression.e2e-spec.ts',
      'rollup.e2e-spec.ts',
    ],
    v2Coverage: [
      'computed.e2e.spec.ts',
      'conditional-lookup.e2e.spec.ts',
      'conditional-rollup-dynamic-date.e2e.spec.ts',
      'createRecordLink.e2e.spec.ts',
      'deleteRecords-with-links.e2e.spec.ts',
      'link-multi-fields-same-table.e2e.spec.ts',
      'lookup-field-behaviors.e2e.spec.ts',
      'rollup-expressions.e2e.spec.ts',
    ],
  },
  {
    domain: 'formula and computed propagation',
    sources: [
      'computed-orchestrator.e2e-spec.ts',
      'computed-user-field.e2e-spec.ts',
      'computed-version-regression.e2e-spec.ts',
      'formula-boolean-numeric-coercion.e2e-spec.ts',
      'formula-conditional-lookup-numeric-if.e2e-spec.ts',
      'formula-conditional-numeric-cast-regression.e2e-spec.ts',
      'formula-counta-lookup-ancestry.e2e-spec.ts',
      'formula-countall-user-link-lookup.e2e-spec.ts',
      'formula-datetime-format.e2e-spec.ts',
      'formula-datetime-parse-update.e2e-spec.ts',
      'formula-delete-chain.e2e-spec.ts',
      'formula-field.e2e-spec.ts',
      'formula-fromnow-tonow.e2e-spec.ts',
      'formula-inline-computed-update.e2e-spec.ts',
      'formula-int-search-link-regression.e2e-spec.ts',
      'formula-left-array-flatten.e2e-spec.ts',
      'formula-lookup-sum-regression.e2e-spec.ts',
      'formula-meta.e2e-spec.ts',
      'formula-metadata-coercion.e2e-spec.ts',
      'formula-numeric-blank-regression.e2e-spec.ts',
      'formula-single-select-regression.e2e-spec.ts',
      'formula-timezone-convert.e2e-spec.ts',
      'formula.e2e-spec.ts',
      'generated-column-blank-if.e2e-spec.ts',
      'generated-column-numeric-coercion.e2e-spec.ts',
      'personal-income-tax.e2e-spec.ts',
      'select-formula-numeric-coercion.e2e-spec.ts',
    ],
    v2Coverage: [
      'computed-formula-field-crud.e2e.spec.ts',
      'computed-user-driven.e2e.spec.ts',
      'computed.e2e.spec.ts',
      'formula-metadata-coercion.e2e.spec.ts',
      'formula.e2e.spec.ts',
    ],
  },
  {
    domain: 'table and view lifecycle',
    sources: [
      'table-concurrency.e2e-spec.ts',
      'table-duplicate.e2e-spec.ts',
      'table-lifecycle-full.e2e-spec.ts',
      'view-option.e2e-spec.ts',
    ],
    v2Coverage: [
      'createTable.e2e.spec.ts',
      'duplicateTable.e2e.spec.ts',
      'viewOperations.e2e.spec.ts',
    ],
  },
] as const satisfies readonly V1TableIntegrationRetirement[];

const configDirectory = dirname(fileURLToPath(import.meta.url));
const communityTestDirectory = resolve(configDirectory, 'test');
const v2E2eDirectory = resolve(configDirectory, '../../packages/v2/e2e/src');

const duplicateSources = retirements
  .flatMap(({ sources }) => sources)
  .filter((source, index, sources) => sources.indexOf(source) !== index);

if (duplicateSources.length > 0) {
  throw new Error(`Duplicate retired v1 integration files: ${duplicateSources.join(', ')}`);
}

for (const { domain, sources, v2Coverage } of retirements) {
  for (const source of sources) {
    if (!existsSync(resolve(communityTestDirectory, source))) {
      throw new Error(`Missing retired v1 integration file for ${domain}: ${source}`);
    }
  }

  for (const replacement of v2Coverage) {
    if (!existsSync(resolve(v2E2eDirectory, replacement))) {
      throw new Error(`Missing v2 replacement coverage for ${domain}: ${replacement}`);
    }
  }
}

export const v2CoveredV1TableIntegrationFiles = retirements.flatMap(({ sources }) => sources);
