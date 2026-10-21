import { expect, describe, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';
import { RenameTableCommand } from './RenameTableCommand';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);

describe('RenameTableCommand', () => {
  it('creates command from valid input', () => {
    const baseIdResult = createBaseId('a');
    const tableIdResult = createTableId('a');
    [baseIdResult, tableIdResult].forEach((r) => r._unsafeUnwrap());
    expect(baseIdResult.isOk()).toBe(true);
    expect(tableIdResult.isOk()).toBe(true);

    const commandResult = RenameTableCommand.create({
      baseId: baseIdResult._unsafeUnwrap().toString(),
      tableId: tableIdResult._unsafeUnwrap().toString(),
      name: 'Renamed',
    });
    expect(commandResult.isOk()).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(RenameTableCommand.create({ baseId: 'bad', tableId: 'bad', name: '' }).isErr()).toBe(
      true
    );
  });
});
