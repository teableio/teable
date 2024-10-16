import type { parseDsnOrThrow } from '@httpx/dsn-parser';
import { isParsableDsn as isParsable, parseDsn as parse } from '@httpx/dsn-parser';

export type IDsn = ReturnType<typeof parseDsnOrThrow>;

export function parseDsn(dsn: string): IDsn {
  const parsedDsn = parse(dsn);
  if (dsn.startsWith('file:')) {
    return {
      host: 'localhost',
      driver: 'sqlite3',
    };
  }

  if (!parsedDsn.success) {
    throw new Error(`DATABASE_URL ${parsedDsn.reason}`);
  }
  if (!parsedDsn.value.port) {
    throw new Error(`DATABASE_URL must provide a port`);
  }

  return parsedDsn.value;
}

export function isParsableDsn(dsn: unknown) {
  return (dsn as string).startsWith('file:') || isParsable(dsn);
}

export enum DriverClient {
  Pg = 'postgresql',
  Sqlite = 'sqlite3',
}
