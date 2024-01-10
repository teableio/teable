import type { PrismaClient } from '@prisma/client';

export abstract class AbstractSeed {
  constructor(
    public prisma: PrismaClient,
    public driver: 'postgresql' | 'sqlite3',
    public outLog: boolean = false
  ) {}

  abstract execute(): Promise<void>;

  protected log = (operation: 'UPSERT' | 'CREATE' | 'UPDATE', msg: string) => {
    (process.env.CI || this.outLog) && console.log(`${operation}: ${msg}`);
  };
}
