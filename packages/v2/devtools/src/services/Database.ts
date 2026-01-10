import { Context, Effect } from 'effect';
import type { DependencyContainer } from '@teable/v2-di';

export class Database extends Context.Tag('Database')<
  Database,
  {
    readonly container: DependencyContainer;
    readonly connectionString: string;
  }
>() {}

export class DatabaseConfig extends Context.Tag('DatabaseConfig')<
  DatabaseConfig,
  {
    readonly connectionString: string;
  }
>() {}
