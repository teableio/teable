import { Command } from '@effect/cli';
import { explainCreate, explainUpdate, explainDelete } from './explain';
import { mockGenerate } from './mock';
import { recordsList, recordsGet } from './records';
import { relations } from './relations';
import {
  underlyingTables,
  underlyingTable,
  underlyingFields,
  underlyingField,
  underlyingRecords,
  underlyingRecord,
} from './underlying';

// explain subcommand group
export const explain = Command.make('explain').pipe(
  Command.withDescription('Explain command execution plans'),
  Command.withSubcommands([explainCreate, explainUpdate, explainDelete])
);

// mock subcommand group
export const mock = Command.make('mock').pipe(
  Command.withDescription('Mock data operations'),
  Command.withSubcommands([mockGenerate])
);

// records subcommand group (application layer queries)
export const records = Command.make('records').pipe(
  Command.withDescription('Query records via application layer'),
  Command.withSubcommands([recordsList, recordsGet])
);

// underlying subcommand group
export const underlying = Command.make('underlying').pipe(
  Command.withDescription('Query underlying database metadata and data'),
  Command.withSubcommands([
    underlyingTables,
    underlyingTable,
    underlyingFields,
    underlyingField,
    underlyingRecords,
    underlyingRecord,
  ])
);

// Root command
export const root = Command.make('teable-devtools').pipe(
  Command.withDescription('Teable v2 developer tools CLI'),
  Command.withSubcommands([explain, mock, records, relations, underlying])
);

export { relations };
