import { IntegrityIssueType } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { IntegrityV2Controller } from './integrity-v2.controller';
import { IntegrityController } from './integrity.controller';

const createAudit = () => ({ emitAtomic: vi.fn().mockResolvedValue(undefined) });

describe('IntegrityController link-fix audit', () => {
  it('records the fixed issues of a base link repair', async () => {
    const fixed = [
      { type: IntegrityIssueType.ForeignKeyNotFound, message: 'a', fieldId: 'fld1' },
      { type: IntegrityIssueType.ForeignKeyNotFound, message: 'b', fieldId: 'fld2' },
    ];
    const linkIntegrityService = { linkIntegrityFix: vi.fn().mockResolvedValue(fixed) };
    const audit = createAudit();
    const controller = new IntegrityController(linkIntegrityService as never, audit as never);

    await expect(controller.fixBaseIntegrity('bse1', 'tbl1')).resolves.toBe(fixed);

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'base.integrity.repair',
      resourceId: 'bse1',
      params: {
        baseId: 'bse1',
        tableId: 'tbl1',
        mode: 'link-fix',
        fixedCount: 2,
        fixedByType: { [IntegrityIssueType.ForeignKeyNotFound]: 2 },
      },
    });
  });
});

describe('IntegrityV2Controller repair-stream audit', () => {
  const createResponse = () => ({
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    writableEnded: false,
    destroyed: false,
  });

  const createController = () => {
    const results = [
      { id: 'r1', status: 'success' },
      { id: 'r2', status: 'success' },
    ];
    const stream = async function* () {
      yield* results;
    };
    const integrityV2Service = {
      createRepairStream: vi.fn(async () => stream()),
      createBaseRepairStream: vi.fn(async () => stream()),
    };
    const cls = { get: vi.fn((key: string) => (key === 'useV2' ? true : undefined)) };
    const audit = createAudit();
    const controller = new IntegrityV2Controller(
      integrityV2Service as never,
      cls as never,
      audit as never
    );
    return { controller, integrityV2Service, audit };
  };

  it('records a table repair once when the stream opens, with option keys but not values', async () => {
    const { controller, audit } = createController();
    const res = createResponse();

    await controller.repairTable(
      'tbl1',
      { fieldId: 'fld1', ruleId: 'rule1', manualRepairValues: { keep: 'fldSecretChoice' } },
      res as never
    );

    expect(audit.emitAtomic).toHaveBeenCalledTimes(1);
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'table.integrity.repair',
      resourceId: 'tbl1',
      params: {
        tableId: 'tbl1',
        mode: 'schema',
        fieldId: 'fld1',
        ruleId: 'rule1',
        targetStatuses: undefined,
        manualRepairKeys: ['keep'],
      },
    });
    expect(JSON.stringify(audit.emitAtomic.mock.calls)).not.toContain('fldSecretChoice');
    // every streamed result still reaches the client
    expect(res.write).toHaveBeenCalledTimes(4);
  });

  it('records a base repair but not a dry run', async () => {
    const { controller, audit } = createController();

    await controller.repairBase('bse1', { dryRun: true }, createResponse() as never);
    expect(audit.emitAtomic).not.toHaveBeenCalled();

    await controller.repairBase('bse1', { targetStatuses: ['error'] }, createResponse() as never);
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'base.integrity.repair',
      resourceId: 'bse1',
      params: { baseId: 'bse1', mode: 'schema', targetStatuses: ['error'] },
    });
  });

  it('records nothing when the repair target cannot be resolved', async () => {
    const { controller, integrityV2Service, audit } = createController();
    integrityV2Service.createRepairStream.mockRejectedValue(new Error('Table not found'));

    await controller.repairTable('tblGone', {}, createResponse() as never);

    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });
});
