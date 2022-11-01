import { parseDsn } from '@soluble/dsn-parser';
import type { ParsedDsn } from '@soluble/dsn-parser';
import isPortReachable from 'is-port-reachable';
import pc from 'picocolors';

const dsn = process.env.E2E_PRISMA_DATABASE_URL as string;

export const getValidatedDsn = (): { dsn: string } & ParsedDsn => {
  const parsedDsn = parseDsn(dsn);
  if (!parsedDsn.success) {
    throw new Error(
      `${pc.bgRed(`[SetupError]: E2E_PRISMA_DATABASE_URL ${parsedDsn.reason}`)}`
    );
  }
  if (!parsedDsn.value.port) {
    throw new Error(
      `${pc.bgRed(`[SetupError]: E2E_PRISMA_DATABASE_URL must provide a port`)}`
    );
  }
  return {
    dsn,
    ...parsedDsn.value,
  };
};

export const getAndCheckDatabaseDsn = async (): Promise<string> => {
  const { dsn, port, host } = getValidatedDsn();
  const reachable = await isPortReachable(port as unknown as number, {
    host: host,
    timeout: 5_000,
  });

  if (!reachable) {
    throw new Error(
      `${pc.bgRed(
        `[SetupError]: Unreachable required e2e database ${[host, port].join(
          ':'
        )}`
      )}`
    );
  }
  return dsn;
};
