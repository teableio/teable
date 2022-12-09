import path from 'path';
import Database from 'better-sqlite3';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
let dbPath = process.env.PRISMA_DATABASE_URL!.split(':')[1];

dbPath = path.resolve(__dirname, dbPath);
console.log(`current sqlite file: ${dbPath}`);

const sqliteDb: Database.Database = new Database(dbPath, { verbose: console.log });
sqliteDb.pragma('journal_mode = WAL');

export { sqliteDb };
