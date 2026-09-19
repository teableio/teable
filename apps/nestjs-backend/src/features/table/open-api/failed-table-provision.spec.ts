import { describe, expect, it } from 'vitest';
import {
  operationTargetsTable,
  terminalTableFailure,
  type ProvisionOperation,
} from './failed-table-provision';
const operation = (status: string, id = 'operation'): ProvisionOperation => ({
  id,
  status,
  type: 'table.import',
  table_id: 'table',
  resource_id: 'table',
  payload: null,
  last_error: null,
});
describe('terminal table failure selection', () => {
  it('includes dead but rejects active retries and newer successful operations', () => {
    const dead = operation('dead');
    expect(terminalTableFailure([dead], 'table')).toBe(dead);
    for (const status of ['pending', 'running', 'error', 'ready']) {
      expect(terminalTableFailure([operation(status, 'new'), dead], 'table')).toBeUndefined();
    }
    expect(terminalTableFailure([dead, operation('running', 'old')], 'table')).toBeUndefined();
  });
  it('recognizes batch payloads without confusing unrelated tables', () => {
    const batch = {
      ...operation('dead'),
      table_id: null,
      resource_id: 'base',
      payload: { tableIds: ['table'] },
    };
    expect(operationTargetsTable(batch, 'table')).toBe(true);
    expect(operationTargetsTable(batch, 'other')).toBe(false);
  });
});

it('does not expose a historical failure after a successful operation', () => {
  expect(
    terminalTableFailure([operation('ready', 'new'), operation('dead', 'old')], 'table')
  ).toBeUndefined();
});
