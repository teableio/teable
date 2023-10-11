import { isParsableDsn as isParsable, parseDsn as parse } from '@soluble/dsn-parser';

export function parseDsn(dsn: string) {
  const parsedDsn = parse(dsn);
  if (dsn.startsWith('file:')) {
    return {
      dsn,
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

  return {
    dsn,
    ...parsedDsn.value,
  };
}

export function isParsableDsn(dsn: unknown) {
  return (dsn as string).startsWith('file:') || isParsable(dsn);
}
