import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';
import { DeleteTableCommand } from './DeleteTableCommand';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);

describe('DeleteTableCommand', () => {
  it('creates command from valid input', () => {
    const baseIdResult = createBaseId('a');
    const tableIdResult = createTableId('a');
    expect([baseIdResult, tableIdResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableIdResult.isErr()) return;

    const commandResult = DeleteTableCommand.create({
      baseId: baseIdResult.value.toString(),
      tableId: tableIdResult.value.toString(),
    });
    expect(commandResult.isOk()).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(DeleteTableCommand.create({ baseId: 'bad', tableId: 'bad' }).isErr()).toBe(true);
  });
});
