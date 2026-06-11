import { Layer } from 'effect';
import type { CommandExplain } from '../services/CommandExplain';
import type { ComputedTaskControl } from '../services/ComputedTaskControl';
import type { ComputedTaskInspector } from '../services/ComputedTaskInspector';
import type { DatabaseConfig } from '../services/Database';
import type { DebugData } from '../services/DebugData';
import type { DotTeaImporter } from '../services/DotTeaImporter';
import type { MockRecords } from '../services/MockRecords';
import type { Output } from '../services/Output';
import type { RecordMutation } from '../services/RecordMutation';
import type { SchemaChecker } from '../services/SchemaChecker';
import type { SchemaOperationControl } from '../services/SchemaOperationControl';
import type { SchemaRepairer } from '../services/SchemaRepairer';
import type { TableCreator } from '../services/TableCreator';
import { CommandExplainLive } from './CommandExplainLive';
import { ComputedTaskControlLive } from './ComputedTaskControlLive';
import { ComputedTaskInspectorLive } from './ComputedTaskInspectorLive';
import { DatabaseLive, DatabaseConfigFromOption } from './DatabaseLive';
import { DebugDataLive } from './DebugDataLive';
import { DotTeaImporterLive } from './DotTeaImporterLive';
import { MockRecordsLive } from './MockRecordsLive';
import { OutputLive } from './OutputLive';
import { RecordMutationLive } from './RecordMutationLive';
import { SchemaCheckerLive } from './SchemaCheckerLive';
import { SchemaOperationControlLive } from './SchemaOperationControlLive';
import { SchemaRepairerLive } from './SchemaRepairerLive';
import { TableCreatorLive } from './TableCreatorLive';

/**
 * Create the Database layer with optional connection string override
 */
const createDatabaseLayer = (connectionString?: string) =>
  DatabaseLive.pipe(Layer.provide(DatabaseConfigFromOption(connectionString)));

/**
 * Layer for read-only operations (DebugData + CommandExplain + SchemaChecker)
 */
export const ReadOnlyLayer = (connectionString?: string) => {
  const dbLayer = createDatabaseLayer(connectionString);
  return Layer.mergeAll(
    OutputLive,
    DebugDataLive.pipe(Layer.provide(dbLayer)),
    CommandExplainLive.pipe(Layer.provide(dbLayer)),
    SchemaCheckerLive.pipe(Layer.provide(dbLayer))
  );
};

/**
 * Layer for mock operations (needs write access)
 * Includes DatabaseConfig for security validation
 */
export const MockLayer = (connectionString?: string) => {
  const configLayer = DatabaseConfigFromOption(connectionString);
  const dbLayer = createDatabaseLayer(connectionString);
  return Layer.mergeAll(OutputLive, configLayer, MockRecordsLive.pipe(Layer.provide(dbLayer)));
};

/**
 * Full layer combining all services
 */
export const FullLayer = (connectionString?: string) => {
  const configLayer = DatabaseConfigFromOption(connectionString);
  const dbLayer = createDatabaseLayer(connectionString);
  return Layer.mergeAll(
    OutputLive,
    configLayer,
    DebugDataLive.pipe(Layer.provide(dbLayer)),
    CommandExplainLive.pipe(Layer.provide(dbLayer)),
    ComputedTaskControlLive.pipe(Layer.provide(dbLayer)),
    ComputedTaskInspectorLive.pipe(Layer.provide(dbLayer)),
    MockRecordsLive.pipe(Layer.provide(dbLayer)),
    SchemaCheckerLive.pipe(Layer.provide(dbLayer)),
    SchemaOperationControlLive.pipe(Layer.provide(dbLayer)),
    SchemaRepairerLive.pipe(Layer.provide(dbLayer)),
    TableCreatorLive.pipe(Layer.provide(dbLayer)),
    DotTeaImporterLive.pipe(Layer.provide(dbLayer)),
    RecordMutationLive.pipe(Layer.provide(dbLayer))
  );
};

/**
 * Type-safe layer for CLI - provides all possible services
 */
export type AppLayerType = Layer.Layer<
  Output['Type'] &
    DebugData['Type'] &
    CommandExplain['Type'] &
    ComputedTaskControl['Type'] &
    ComputedTaskInspector['Type'] &
    MockRecords['Type'] &
    SchemaChecker['Type'] &
    SchemaOperationControl['Type'] &
    SchemaRepairer['Type'] &
    TableCreator['Type'] &
    DotTeaImporter['Type'] &
    RecordMutation['Type'] &
    DatabaseConfig['Type'],
  Error,
  never
>;
