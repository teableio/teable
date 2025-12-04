import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

const schemaRelative = process.env.PRISMA_SCHEMA_PATH ?? 'prisma/postgres/schema.prisma';
const schemaPath = path.resolve(packageRoot, schemaRelative);

if (!existsSync(schemaPath)) {
  console.error(`[prisma-generate] schema not found at ${schemaPath}`);
  console.error('Set PRISMA_SCHEMA_PATH to a valid schema (e.g., prisma/sqlite/schema.prisma).');
  process.exit(1);
}

const prismaBinary = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
const prismaCli = path.resolve(packageRoot, 'node_modules', '.bin', prismaBinary);

try {
  execFileSync(prismaCli, ['generate', '--schema', schemaPath], {
    stdio: 'inherit',
    cwd: packageRoot,
  });
} catch (error) {
  console.error('[prisma-generate] failed to generate Prisma client.');
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(
    typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
      ? error.status
      : 1
  );
}
