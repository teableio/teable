import type { ParseArgsConfig } from 'node:util';
import { parseArgs } from 'node:util';
import { PrismaClient } from '../';
import { SpaceSeeds } from '../src/seeds/e2e/space-seeds';
import { UserSeeds } from '../src/seeds/e2e/user-seeds';

let prisma: PrismaClient | undefined;

const options: ParseArgsConfig['options'] = {
  e2e: { type: 'boolean', default: false },
  log: { type: 'boolean', default: false },
};

async function main() {
  const {
    values: { e2e, log },
  } = parseArgs({ options });
  const databaseUrl = process.env.PRISMA_DATABASE_URL!;

  console.log('🌱      Seed E2E: ', e2e);
  console.log('🌱   environment: ', process.env.NODE_ENV);
  console.log('🌱  Database Url: ', databaseUrl);

  prisma = new PrismaClient();

  if (e2e) {
    const userSeeds = new UserSeeds(prisma, Boolean(log));
    await userSeeds.execute();

    const spaceSeeds = new SpaceSeeds(prisma, Boolean(log));
    await spaceSeeds.execute();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
