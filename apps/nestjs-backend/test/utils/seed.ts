/* eslint-disable @typescript-eslint/no-explicit-any */
import { seeding } from './record-mock';

async function run() {
  const [, , tableId, mockDataNum = 250000] = process.argv as any[];
  if (!tableId) {
    throw new Error('💥No bugs. No bugs at all.💥');
  }

  await seeding(tableId, mockDataNum);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
