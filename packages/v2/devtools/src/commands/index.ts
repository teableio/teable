import { Command } from '@effect/cli';
import {
  computedPause,
  computedPauses,
  computedReplay,
  computedResume,
  computedRunTask,
  computedSummary,
  computedTask,
  computedTasks,
} from './computed';
import { dottea } from './dottea';
import {
  explainCreate,
  explainUpdate,
  explainDelete,
  explainCreateField,
  explainUpdateField,
  explainDeleteField,
  explainDeleteTable,
  explainPaste,
} from './explain';
import { mockGenerate } from './mock';
import { recordsList, recordsGet, recordsCreate, recordsUpdate, recordsDelete } from './records';
import { relations } from './relations';
import { schemaTable, schemaField, schemaRepair } from './schema';
import {
  schemaOperationList,
  schemaOperationMarkDead,
  schemaOperationRetry,
} from './schema-operation';
import { tablesCreate, tablesDescribeSchema } from './tables';
import {
  underlyingTables,
  underlyingTable,
  underlyingFields,
  underlyingField,
  underlyingRecords,
  underlyingRecord,
  underlyingCanarySpace,
  underlyingUndoCapture,
} from './underlying';

// explain subcommand group
export const explain = Command.make('explain').pipe(
  Command.withDescription('Explain command execution plans'),
  Command.withSubcommands([
    explainCreate,
    explainUpdate,
    explainDelete,
    explainCreateField,
    explainUpdateField,
    explainDeleteField,
    explainDeleteTable,
    explainPaste,
  ])
);

// mock subcommand group
export const mock = Command.make('mock').pipe(
  Command.withDescription('Mock data operations'),
  Command.withSubcommands([mockGenerate])
);

// computed task subcommand group
export const computed = Command.make('computed').pipe(
  Command.withDescription('Operate computed outbox tasks'),
  Command.withSubcommands([
    computedPause,
    computedResume,
    computedPauses,
    computedSummary,
    computedTasks,
    computedTask,
    computedRunTask,
    computedReplay,
  ])
);

// records subcommand group (application layer queries and mutations)
export const records = Command.make('records').pipe(
  Command.withDescription('Query and mutate records via application layer'),
  Command.withSubcommands([recordsList, recordsGet, recordsCreate, recordsUpdate, recordsDelete])
);

// schema subcommand group
export const schema = Command.make('schema').pipe(
  Command.withDescription('Check database schema (indexes, constraints, columns)'),
  Command.withSubcommands([schemaTable, schemaField, schemaRepair])
);

// schema operation subcommand group
export const schemaOperation = Command.make('schema-operation').pipe(
  Command.withDescription('Inspect and control schema operation repair sagas'),
  Command.withSubcommands([schemaOperationList, schemaOperationRetry, schemaOperationMarkDead])
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
    underlyingCanarySpace,
    underlyingUndoCapture,
  ])
);

// Root command
export const root = Command.make('teable-devtools').pipe(
  Command.withDescription('Teable v2 developer tools CLI'),
  Command.withSubcommands([
    computed,
    explain,
    mock,
    records,
    relations,
    schema,
    schemaOperation,
    tables,
    underlying,
    dottea,
  ])
);

export { dottea, relations };
