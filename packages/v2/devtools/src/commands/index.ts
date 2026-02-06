import { Command } from '@effect/cli';
import { dottea } from './dottea';
import { explainCreate, explainUpdate, explainDelete, explainPaste } from './explain';
import { mockGenerate } from './mock';
import { recordsList, recordsGet, recordsCreate, recordsUpdate, recordsDelete } from './records';
import { relations } from './relations';
import { schemaTable, schemaField } from './schema';
import { tablesCreate, tablesDescribeSchema } from './tables';
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
  Command.withSubcommands([explainCreate, explainUpdate, explainDelete, explainPaste])
);

// mock subcommand group
export const mock = Command.make('mock').pipe(
  Command.withDescription('Mock data operations'),
  Command.withSubcommands([mockGenerate])
);

// records subcommand group (application layer queries and mutations)
export const records = Command.make('records').pipe(
  Command.withDescription('Query and mutate records via application layer'),
  Command.withSubcommands([recordsList, recordsGet, recordsCreate, recordsUpdate, recordsDelete])
);

// schema subcommand group
export const schema = Command.make('schema').pipe(
  Command.withDescription('Check database schema (indexes, constraints, columns)'),
  Command.withSubcommands([schemaTable, schemaField])
);

// tables subcommand group
export const tables = Command.make('tables').pipe(
  Command.withDescription('Table management operations'),
  Command.withSubcommands([tablesCreate, tablesDescribeSchema])
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
  Command.withSubcommands([explain, mock, records, relations, schema, tables, underlying, dottea])
);

export { dottea, relations };
