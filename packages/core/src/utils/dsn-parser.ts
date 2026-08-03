import type { parseDsnOrThrow } from '@httpx/dsn-parser';
import { parseDsn as parse } from '@httpx/dsn-parser';

export type IDsn = ReturnType<typeof parseDsnOrThrow>;

export enum DriverClient {
  Pg = 'postgresql',
}

export function parseDsn(dsn: string): IDsn {
  const parsedDsn = parse(dsn);

  if (!parsedDsn.success) {
    throw new Error(`DATABASE_URL ${parsedDsn.reason}`);
  }
  if (!parsedDsn.value.port) {
    throw new Error(`DATABASE_URL must provide a port`);
  }
  if (parsedDsn.value.driver !== DriverClient.Pg) {
    throw new Error(`DATABASE_URL driver ${parsedDsn.value.driver} is not supported`);
  }

  return parsedDsn.value;
}

export function isParsableDsn(dsn: unknown) {
  if (typeof dsn !== 'string') {
    return false;
  }
  try {
    parseDsn(dsn);
    return true;
  } catch {
    return false;
  }
}
