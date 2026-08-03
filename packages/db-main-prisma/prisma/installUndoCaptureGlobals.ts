import { undoCaptureGlobalStatements } from '../../v2/adapter-table-repository-postgres/src/shared/undoCaptureGlobalsSql';

type IRawSqlExecutor = {
  $executeRawUnsafe(query: string): Promise<unknown>;
};

export async function installUndoCaptureGlobals(
  prisma: IRawSqlExecutor,
  driver: string
): Promise<void> {
  if (driver !== 'postgresql') {
    return;
  }

  // E2E databases are bootstrapped from seeds instead of the full migration
  // pipeline, so install the migration-owned globals explicitly here.
  for (const statement of undoCaptureGlobalStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
