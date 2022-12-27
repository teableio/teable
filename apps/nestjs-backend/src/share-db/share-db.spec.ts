import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { dbPath } from '@teable-group/db-main-prisma';
import { ShareDb } from './share-db';
import { SqliteDB } from './sqlite.adapter';

describe('ShareDb', () => {
  let provider: ShareDb;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'SHAREDB_CONFIG',
          useValue: {
            db: new SqliteDB({
              filename: dbPath,
            }),
          },
        },
        ShareDb,
      ],
    }).compile();

    provider = module.get<ShareDb>(ShareDb);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('create simple document', (done) => {
    const randomTitle = `B:${Math.floor(Math.random() * 1000)}`;
    const doc = provider.connect().get('books', randomTitle);
    doc.create({ title: randomTitle }, function (error) {
      if (error) throw error;
      doc.submitOp({ p: ['author'], oi: 'George Orwell' }, undefined, (error: unknown) => {
        if (error) throw error;
        console.log('submit succeed!');
        done();
      });
    });
  });
});
