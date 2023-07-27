import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
let dbPath = process.env.PRISMA_DATABASE_URL!.split(':')[1];

dbPath = path.resolve(__dirname, dbPath);
console.log(`current sqlite file: ${dbPath}`);

export { dbPath };
