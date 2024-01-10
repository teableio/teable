import type { ParseArgsConfig } from 'node:util';
import { parseArgs } from 'node:util';
import { PrismaClient } from '../';
import { SpaceSeeds } from '../src/seeds/e2e/space-seeds';
import { UserSeeds } from '../src/seeds/e2e/user-seeds';

const prisma = new PrismaClient();

const options: ParseArgsConfig['options'] = {
  e2e: { type: 'boolean', default: false },
  log: { type: 'boolean', default: false },
  environment: { type: 'string' },
};

async function main() {
  const {
    values: { environment, e2e, log },
  } = parseArgs({ options });

  console.log('🌱  Seed E2E: ', e2e);

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
    await prisma.$disconnect();
  });
