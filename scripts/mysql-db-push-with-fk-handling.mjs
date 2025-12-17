#!/usr/bin/env node
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const databaseUrl = process.env.PRISMA_DATABASE_URL || 'mysql://root:your_password@localhost:3306/your_database_name';

// Extract database name from URL
const dbMatch = databaseUrl.match(/mysql:\/\/[^@]+@[^/]+\/([^?]+)/);
if (!dbMatch) {
  console.error('Could not extract database name from PRISMA_DATABASE_URL');
  process.exit(1);
}
const dbName = dbMatch[1];

console.log(`Disabling foreign key checks for database: ${dbName}`);

try {
  // Disable foreign key checks
  // Note: This assumes MySQL credentials are configured via environment variables or .my.cnf
  // For production, use: mysql -u ${MYSQL_USER} -p${MYSQL_PASSWORD} ${dbName} -e "SET FOREIGN_KEY_CHECKS=0;"
  execSync(
    `mysql -u root -p ${dbName} -e "SET FOREIGN_KEY_CHECKS=0;"`,
    { stdio: 'inherit', cwd: rootDir }
  );

  // Run prisma db push
  console.log('Running Prisma db push...');
  execSync(
    `pnpm prisma db push --schema ./prisma/mysql/schema.prisma --accept-data-loss --skip-generate`,
    { 
      stdio: 'inherit', 
      cwd: join(rootDir, 'packages/db-main-prisma'),
      env: { ...process.env, PRISMA_DATABASE_URL: databaseUrl }
    }
  );

  // Re-enable foreign key checks
  console.log('Re-enabling foreign key checks...');
  execSync(
    `mysql -u root -p ${dbName} -e "SET FOREIGN_KEY_CHECKS=1;"`,
    { stdio: 'inherit', cwd: rootDir }
  );

  // Generate Prisma client
  console.log('Generating Prisma client...');
  execSync(
    `pnpm prisma-generate --schema ./prisma/mysql/schema.prisma`,
    { 
      stdio: 'inherit', 
      cwd: join(rootDir, 'packages/db-main-prisma'),
      env: { ...process.env, PRISMA_DATABASE_URL: databaseUrl }
    }
  );

  console.log('✅ Database schema pushed successfully!');
} catch (error) {
  console.error('❌ Error:', error.message);
  // Try to re-enable foreign key checks even on error
  try {
    execSync(
      `mysql -u root -p ${dbName} -e "SET FOREIGN_KEY_CHECKS=1;"`,
      { stdio: 'inherit', cwd: rootDir }
    );
  } catch (e) {
    // Ignore errors when re-enabling
  }
  process.exit(1);
}

