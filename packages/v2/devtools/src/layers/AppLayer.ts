import { Layer } from 'effect';
import { DatabaseLive, DatabaseConfigFromOption } from './DatabaseLive';
import { DebugDataLive } from './DebugDataLive';
import { CommandExplainLive } from './CommandExplainLive';
import { MockRecordsLive } from './MockRecordsLive';
import { OutputLive } from './OutputLive';
import { DatabaseConfig } from '../services/Database';

/**
 * Create the Database layer with optional connection string override
 */
const createDatabaseLayer = (connectionString?: string) =>
  DatabaseLive.pipe(Layer.provide(DatabaseConfigFromOption(connectionString)));

/**
 * Layer for read-only operations (DebugData + CommandExplain)
 */
export const ReadOnlyLayer = (connectionString?: string) => {
  const dbLayer = createDatabaseLayer(connectionString);
  return Layer.mergeAll(
    OutputLive,
    DebugDataLive.pipe(Layer.provide(dbLayer)),
    CommandExplainLive.pipe(Layer.provide(dbLayer))
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
    MockRecordsLive.pipe(Layer.provide(dbLayer))
  );
};

/**
 * Type-safe layer for CLI - provides all possible services
 */
export type AppLayerType = Layer.Layer<
  import('../services/Output').Output['Type'] &
    import('../services/DebugData').DebugData['Type'] &
    import('../services/CommandExplain').CommandExplain['Type'] &
    import('../services/MockRecords').MockRecords['Type'] &
    DatabaseConfig['Type'],
  Error,
  never
>;
