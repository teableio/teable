import { Layer } from 'effect';
import type { CommandExplain } from '../services/CommandExplain';
import type { DatabaseConfig } from '../services/Database';
import type { DebugData } from '../services/DebugData';
import type { MockRecords } from '../services/MockRecords';
import type { Output } from '../services/Output';
import type { SchemaChecker } from '../services/SchemaChecker';
import type { TableCreator } from '../services/TableCreator';
import { CommandExplainLive } from './CommandExplainLive';
import { DatabaseLive, DatabaseConfigFromOption } from './DatabaseLive';
import { DebugDataLive } from './DebugDataLive';
import { MockRecordsLive } from './MockRecordsLive';
import { OutputLive } from './OutputLive';
import { SchemaCheckerLive } from './SchemaCheckerLive';
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
    MockRecordsLive.pipe(Layer.provide(dbLayer)),
    SchemaCheckerLive.pipe(Layer.provide(dbLayer)),
    TableCreatorLive.pipe(Layer.provide(dbLayer))
  );
};

/**
 * Type-safe layer for CLI - provides all possible services
 */
export type AppLayerType = Layer.Layer<
  Output['Type'] &
    DebugData['Type'] &
    CommandExplain['Type'] &
    MockRecords['Type'] &
    SchemaChecker['Type'] &
    TableCreator['Type'] &
    DatabaseConfig['Type'],
  Error,
  never
>;
