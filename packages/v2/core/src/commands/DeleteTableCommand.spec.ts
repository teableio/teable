import { describe, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { TableId } from '../domain/table/TableId';
import { DeleteTableCommand } from './DeleteTableCommand';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);

describe('DeleteTableCommand', () => {
  it('creates command from valid input', () => {
    const baseIdResult = createBaseId('a');
    const tableIdResult = createTableId('a');
    [baseIdResult, tableIdResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableIdResult._unsafeUnwrap();

    const commandResult = DeleteTableCommand.create({
      baseId: baseIdResult._unsafeUnwrap().toString(),
      tableId: tableIdResult._unsafeUnwrap().toString(),
    });
    commandResult._unsafeUnwrap();
  });

  it('rejects invalid input', () => {
    DeleteTableCommand.create({ baseId: 'bad', tableId: 'bad' })._unsafeUnwrapErr();
  });
});
