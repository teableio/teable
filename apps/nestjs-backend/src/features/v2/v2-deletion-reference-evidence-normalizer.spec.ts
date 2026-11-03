import type { IFieldDeleteReferencesVo, ITableDeleteReferencesVo } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import {
  HOST_DELETION_REFERENCE_REDACTION_REASON,
  V2DeletionReferenceEvidenceNormalizer,
  hostDeletionReferenceEvidenceCodes,
  type HostDeletionReferenceOwner,
  type IHostDeletionReferenceAuthorization,
} from './v2-deletion-reference-evidence-normalizer';

const context = { actorId: 'usr-request' } as never;

const source = (baseId: string, tableId: string, suffix = '') => ({
  id: tableId,
  name: `Table ${suffix || tableId}`,
  base: { id: baseId, name: `Base ${suffix || baseId}` },
});

const allowAll = (): IHostDeletionReferenceAuthorization => ({
  canDiscloseOwner: vi.fn().mockResolvedValue(true),
});

describe('V2DeletionReferenceEvidenceNormalizer', () => {
  it('projects an authorized table collector identity through the public allowlist', async () => {
    const authorization = allowAll();
    const references: ITableDeleteReferencesVo = {
      dependentFields: [
        {
          id: 'fld-visible',
          name: 'Visible field',
          type: 'Formula',
          source: source('bse-visible', 'tbl-visible'),
        },
      ],
    };

    const evidence = await new V2DeletionReferenceEvidenceNormalizer().normalizeTableReferences({
      context,
      authorization,
      collection: { availability: 'available', value: references, exhaustive: true },
    });

    expect(evidence).toEqual({
      effects: [
        {
          code: hostDeletionReferenceEvidenceCodes.effect.tableDeleteField,
          kind: 'dependency.change',
          relatedResources: [
            {
              visibility: 'authorized',
              kind: 'field',
              id: 'fld-visible',
              name: 'Visible field',
            },
          ],
          measures: { references: { basis: 'exact', value: 1, unit: 'field' } },
        },
      ],
      warnings: [],
      coverage: {
        known: [hostDeletionReferenceEvidenceCodes.coverage.tableReferences],
        unknown: [],
      },
    });
    expect(authorization.canDiscloseOwner).toHaveBeenCalledWith(context, {
      kind: 'table',
      baseId: 'bse-visible',
      tableId: 'tbl-visible',
    });
  });

  it('collapses cross-base denials to one cardinality-free redacted field aggregate', async () => {
    const authorization: IHostDeletionReferenceAuthorization = {
      canDiscloseOwner: vi.fn(
        async (_context: unknown, owner: HostDeletionReferenceOwner) => owner.baseId === 'bse-home'
      ),
    };
    const references: IFieldDeleteReferencesVo = {
      ['fld-target']: {
        workflowNodes: [],
        authorityMatrixRoles: [],
        views: [],
        dependentFields: [
          {
            id: 'fld-home',
            name: 'Home field',
            type: 'Formula',
            source: source('bse-home', 'tbl-home'),
          },
          {
            id: 'fld-secret-one',
            name: 'Secret one',
            type: 'Formula',
            source: source('bse-secret', 'tbl-secret', 'Secret'),
          },
          {
            id: 'fld-secret-two',
            name: 'Secret two',
            type: 'Lookup',
            source: source('bse-secret', 'tbl-secret', 'Secret'),
          },
        ],
      },
    };

    const evidence = await new V2DeletionReferenceEvidenceNormalizer().normalizeFieldReferences({
      context,
      authorization,
      target: { baseId: 'bse-home', tableId: 'tbl-target' },
      collection: { availability: 'available', value: references, exhaustive: true },
    });

    expect(authorization.canDiscloseOwner).toHaveBeenCalledTimes(2);
    expect(evidence.effects[0]?.relatedResources).toEqual([
      { visibility: 'authorized', kind: 'field', id: 'fld-home', name: 'Home field' },
      {
        visibility: 'redacted',
        kind: 'field',
        quantity: {
          basis: 'unknown',
          unit: 'field',
          reason: HOST_DELETION_REFERENCE_REDACTION_REASON,
        },
        reason: HOST_DELETION_REFERENCE_REDACTION_REASON,
      },
    ]);
    expect(evidence.effects[0]?.measures).toEqual({
      references: {
        basis: 'unknown',
        unit: 'field',
        reason: HOST_DELETION_REFERENCE_REDACTION_REASON,
      },
    });
    expect(evidence.warnings).toEqual([
      { code: hostDeletionReferenceEvidenceCodes.warning.resourcesRedacted },
    ]);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('fld-secret');
    expect(serialized).not.toContain('Secret');
    expect(serialized).not.toContain('bse-secret');
    expect(serialized).not.toContain('tbl-secret');
  });

  it('deduplicates identities and owners and orders effects and identities deterministically', async () => {
    const authorization = allowAll();
    const duplicate = {
      id: 'fld-b',
      name: 'Field B',
      type: 'Formula',
      source: source('bse-one', 'tbl-one'),
    };
    const workflowNode = {
      id: 'wfn-internal',
      name: 'Internal node',
      type: 'action',
      category: 'automation',
      source: {
        id: 'wfl-a',
        name: 'Workflow A',
        base: { id: 'bse-one', name: 'Base One' },
      },
    };
    const authorityRole = { id: 'role-a', name: 'Role A' };
    const references: IFieldDeleteReferencesVo = {
      ['fld-target-z']: {
        workflowNodes: [workflowNode],
        authorityMatrixRoles: [authorityRole],
        views: [
          {
            id: 'viw-z',
            name: 'View Z',
            type: 'grid',
            source: source('bse-one', 'tbl-one'),
          },
        ],
        dependentFields: [duplicate],
      },
      ['fld-target-a']: {
        workflowNodes: [workflowNode],
        authorityMatrixRoles: [authorityRole],
        views: [
          {
            id: 'viw-a',
            name: 'View A',
            type: 'grid',
            source: source('bse-two', 'tbl-two'),
          },
        ],
        dependentFields: [
          duplicate,
          {
            id: 'fld-a',
            name: 'Field A',
            type: 'Lookup',
            source: source('bse-two', 'tbl-two'),
          },
        ],
      },
    };

    const evidence = await new V2DeletionReferenceEvidenceNormalizer().normalizeFieldReferences({
      context,
      authorization,
      target: { baseId: 'bse-one', tableId: 'tbl-target' },
      collection: { availability: 'available', value: references, exhaustive: true },
    });

    expect(authorization.canDiscloseOwner).toHaveBeenCalledTimes(4);
    expect(authorization.canDiscloseOwner).toHaveBeenCalledWith(context, {
      kind: 'workflow',
      baseId: 'bse-one',
      workflowId: 'wfl-a',
    });
    expect(evidence.effects.map((effect) => effect.code)).toEqual([
      hostDeletionReferenceEvidenceCodes.effect.fieldDeleteField,
      hostDeletionReferenceEvidenceCodes.effect.fieldDeleteView,
      hostDeletionReferenceEvidenceCodes.effect.fieldDeleteWorkflow,
      hostDeletionReferenceEvidenceCodes.effect.fieldDeleteAuthorityRole,
    ]);
    expect(evidence.effects[0]?.relatedResources).toEqual([
      { visibility: 'authorized', kind: 'field', id: 'fld-a', name: 'Field A' },
      { visibility: 'authorized', kind: 'field', id: 'fld-b', name: 'Field B' },
    ]);
    expect(evidence.effects[1]?.relatedResources).toEqual([
      { visibility: 'authorized', kind: 'view', id: 'viw-a', name: 'View A' },
      { visibility: 'authorized', kind: 'view', id: 'viw-z', name: 'View Z' },
    ]);
    expect(evidence.effects[2]?.relatedResources).toEqual([
      { visibility: 'authorized', kind: 'workflow', id: 'wfl-a', name: 'Workflow A' },
    ]);
    expect(evidence.effects[3]?.relatedResources).toEqual([
      { visibility: 'authorized', kind: 'host', id: 'role-a', name: 'Role A' },
    ]);
    expect(JSON.stringify(evidence)).not.toContain('wfn-internal');
    expect(JSON.stringify(evidence)).not.toContain('Internal node');
  });

  it('keeps unavailable and non-exhaustive collection coverage unknown', async () => {
    const normalizer = new V2DeletionReferenceEvidenceNormalizer();
    const unavailable = await normalizer.normalizeFieldReferences({
      context,
      authorization: allowAll(),
      target: { baseId: 'bse-one', tableId: 'tbl-one' },
      collection: { availability: 'unavailable' },
    });

    expect(unavailable).toEqual({
      effects: [],
      warnings: [{ code: hostDeletionReferenceEvidenceCodes.warning.collectionUnavailable }],
      coverage: {
        known: [],
        unknown: [hostDeletionReferenceEvidenceCodes.coverage.fieldReferences],
      },
    });

    const nonExhaustive = await normalizer.normalizeTableReferences({
      context,
      authorization: allowAll(),
      collection: {
        availability: 'available',
        value: { dependentFields: [] },
        exhaustive: false,
      },
    });

    expect(nonExhaustive).toEqual({
      effects: [],
      warnings: [{ code: hostDeletionReferenceEvidenceCodes.warning.collectionNonExhaustive }],
      coverage: {
        known: [hostDeletionReferenceEvidenceCodes.coverage.tableReferencesCollected],
        unknown: [hostDeletionReferenceEvidenceCodes.coverage.tableReferencesExhaustiveness],
      },
    });
  });

  it('does not leak collector internals or raw authorization failures', async () => {
    const allowed = {
      id: 'fld-allowed',
      name: 'Allowed field',
      type: 'Formula',
      source: {
        ...source('bse-allowed', 'tbl-allowed'),
        dbTableName: 'db_table_sentinel',
        ancestry: { folderId: 'folder_sentinel' },
      },
      options: { foreignTableId: 'options_sentinel' },
      config: { expression: 'config_sentinel' },
      dbFieldName: 'db_field_sentinel',
      sql: 'sql_sentinel',
      records: [{ id: 'record_sentinel' }],
      executablePlan: { command: 'plan_sentinel' },
      rawError: 'raw_error_sentinel',
      hook: 'hook_sentinel',
    };
    const denied = {
      id: 'fld-denied-sentinel',
      name: 'Denied name sentinel',
      type: 'Lookup',
      source: source('bse-failing', 'tbl-failing'),
    };
    const references = {
      dependentFields: [allowed, denied],
    } as ITableDeleteReferencesVo;
    const authorization: IHostDeletionReferenceAuthorization = {
      canDiscloseOwner: vi.fn(async (_request, owner) => {
        if (owner.baseId === 'bse-failing') throw new Error('authorization_error_sentinel');
        return true;
      }),
    };

    const evidence = await new V2DeletionReferenceEvidenceNormalizer().normalizeTableReferences({
      context,
      authorization,
      collection: { availability: 'available', value: references, exhaustive: true },
    });

    expect(evidence.effects[0]?.relatedResources).toEqual([
      {
        visibility: 'authorized',
        kind: 'field',
        id: 'fld-allowed',
        name: 'Allowed field',
      },
      expect.objectContaining({
        visibility: 'redacted',
        kind: 'field',
        reason: HOST_DELETION_REFERENCE_REDACTION_REASON,
      }),
    ]);
    expect(evidence.coverage.unknown).toEqual([
      hostDeletionReferenceEvidenceCodes.coverage.authorization,
    ]);
    expect(evidence.warnings).toEqual([
      { code: hostDeletionReferenceEvidenceCodes.warning.authorizationUnavailable },
      { code: hostDeletionReferenceEvidenceCodes.warning.resourcesRedacted },
    ]);

    const serialized = JSON.stringify(evidence);
    for (const sentinel of [
      'type',
      'dbTableName',
      'ancestry',
      'options',
      'config_sentinel',
      'dbFieldName',
      'sql_sentinel',
      'record_sentinel',
      'plan_sentinel',
      'raw_error_sentinel',
      'hook_sentinel',
      'authorization_error_sentinel',
      'fld-denied-sentinel',
      'Denied name sentinel',
      'bse-failing',
      'tbl-failing',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('treats an exhaustive available empty field collection as known evidence', async () => {
    const evidence = await new V2DeletionReferenceEvidenceNormalizer().normalizeFieldReferences({
      context,
      authorization: allowAll(),
      target: { baseId: 'bse-one', tableId: 'tbl-one' },
      collection: {
        availability: 'available',
        value: {},
        exhaustive: true,
      },
    });

    expect(evidence).toEqual({
      effects: [],
      warnings: [],
      coverage: {
        known: [hostDeletionReferenceEvidenceCodes.coverage.fieldReferences],
        unknown: [],
      },
    });
  });
});
