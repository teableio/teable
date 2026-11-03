import { Layer } from 'effect';
import type { CommandExplain } from '../services/CommandExplain';
import type { ComputedTaskControl } from '../services/ComputedTaskControl';
import type { ComputedTaskInspector } from '../services/ComputedTaskInspector';
import type { DatabaseConfig } from '../services/Database';
import type { DataDbMigrationInspector } from '../services/DataDbMigrationInspector';
import type { DebugData } from '../services/DebugData';
import type { DotTeaImporter } from '../services/DotTeaImporter';
import type { MockRecords } from '../services/MockRecords';
import type { Output } from '../services/Output';
import type { PreviewCapabilities } from '../services/PreviewCapabilities';
import type { RecordMutation } from '../services/RecordMutation';
import type { SchemaChecker } from '../services/SchemaChecker';
import type { SchemaOperationControl } from '../services/SchemaOperationControl';
import type { SchemaRepairer } from '../services/SchemaRepairer';
import type { TableCreator } from '../services/TableCreator';
import type { TableQueryOps } from '../services/TableQueryOps';
import { CommandExplainLive } from './CommandExplainLive';
import { ComputedTaskControlLive } from './ComputedTaskControlLive';
import { ComputedTaskInspectorLive } from './ComputedTaskInspectorLive';
import {
  DatabaseLive,
  DatabaseConfigFromOption,
  type DatabaseRuntimeOptions,
} from './DatabaseLive';
import { DataDbMigrationInspectorLive } from './DataDbMigrationInspectorLive';
import { DebugDataLive } from './DebugDataLive';
import { DotTeaImporterLive } from './DotTeaImporterLive';
import { MockRecordsLive } from './MockRecordsLive';
import { OutputLive } from './OutputLive';
import { PreviewCapabilitiesLive } from './PreviewCapabilitiesLive';
import { RecordMutationLive } from './RecordMutationLive';
import { SchemaCheckerLive } from './SchemaCheckerLive';
import { SchemaOperationControlLive } from './SchemaOperationControlLive';
import { SchemaRepairerLive } from './SchemaRepairerLive';
import { TableCreatorLive } from './TableCreatorLive';
import { TableQueryOpsLive } from './TableQueryOpsLive';

/**
 * Create the Database layer with optional connection string and runtime policy.
 */
const createDatabaseLayer = (connectionString?: string, options: DatabaseRuntimeOptions = {}) =>
  DatabaseLive.pipe(Layer.provide(DatabaseConfigFromOption(connectionString, options)));

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
    PreviewCapabilitiesLive,
    DebugDataLive.pipe(Layer.provide(dbLayer)),
    CommandExplainLive.pipe(Layer.provide(dbLayer)),
    ComputedTaskControlLive.pipe(Layer.provide(dbLayer)),
    ComputedTaskInspectorLive.pipe(Layer.provide(dbLayer)),
    DataDbMigrationInspectorLive.pipe(Layer.provide(dbLayer)),
    MockRecordsLive.pipe(Layer.provide(dbLayer)),
    SchemaCheckerLive.pipe(Layer.provide(dbLayer)),
    SchemaOperationControlLive.pipe(Layer.provide(dbLayer)),
    SchemaRepairerLive.pipe(Layer.provide(dbLayer)),
    TableCreatorLive.pipe(Layer.provide(dbLayer)),
    TableQueryOpsLive.pipe(Layer.provide(dbLayer)),
    DotTeaImporterLive.pipe(Layer.provide(dbLayer)),
    RecordMutationLive.pipe(Layer.provide(dbLayer))
  );
};

/**
 * Preview operations need the in-process planner registry but not the general-purpose services.
 * PGlite is opened without schema creation/seeding; the preview reads the supplied database only.
 */
export const PreviewLayer = (
  connectionString?: string,
  options: Pick<DatabaseRuntimeOptions, 'diagnostics'> = {}
) => {
  const runtimeOptions: DatabaseRuntimeOptions = {
    initializePglite: false,
    diagnostics: options.diagnostics ?? 'default',
  };
  const dbLayer = createDatabaseLayer(connectionString, runtimeOptions);
  return Layer.mergeAll(
    OutputLive,
    DatabaseConfigFromOption(connectionString, runtimeOptions),
    CommandExplainLive.pipe(Layer.provide(dbLayer))
  );
};

/** Capability discovery is registry metadata only and never opens a database. */
export const PreviewCapabilitiesLayer = Layer.mergeAll(OutputLive, PreviewCapabilitiesLive);

/**
 * Type-safe layer for CLI - provides all possible services
 */
export type AppLayerType = Layer.Layer<
  Output['Type'] &
    DebugData['Type'] &
    CommandExplain['Type'] &
    PreviewCapabilities['Type'] &
    ComputedTaskControl['Type'] &
    ComputedTaskInspector['Type'] &
    DataDbMigrationInspector['Type'] &
    MockRecords['Type'] &
    SchemaChecker['Type'] &
    SchemaOperationControl['Type'] &
    SchemaRepairer['Type'] &
    TableCreator['Type'] &
    TableQueryOps['Type'] &
    DotTeaImporter['Type'] &
    RecordMutation['Type'] &
    DatabaseConfig['Type'],
  Error,
  never
>;
