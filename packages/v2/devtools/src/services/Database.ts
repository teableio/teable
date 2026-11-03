import type { DependencyContainer } from '@teable/v2-di';
import { Context } from 'effect';

export class Database extends Context.Tag('Database')<
  Database,
  {
    readonly container: DependencyContainer;
    readonly connectionString: string;
    /** Whether this is a pglite connection */
    readonly isPglite: boolean;
    /** Base ID (only available for pglite connections, auto-generated on init) */
    readonly baseId?: string;
  }
>() {}

export class DatabaseConfig extends Context.Tag('DatabaseConfig')<
  DatabaseConfig,
  {
    readonly connectionString: string;
    /** Preview commands inspect an existing database and must never bootstrap or seed it. */
    readonly initializePglite: boolean;
    /** Machine-readable commands keep diagnostics off stdout. */
    readonly diagnostics: 'default' | 'stderr';
  }
>() {}
