import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../global/global.module';
import { ShareDbModule } from './share-db.module';
import { ShareDbService } from './share-db.service';

describe('ShareDb', () => {
  let provider: ShareDbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareDbModule],
    }).compile();

    provider = module.get<ShareDbService>(ShareDbService);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  // it('create simple document', (done) => {
  //   const randomTitle = `B:${Math.floor(Math.random() * 1000)}`;
  //   const doc = provider.connect().get('books', randomTitle);
  //   doc.create({ title: randomTitle }, function (error) {
  //     if (error) throw error;
  //     doc.submitOp({ p: ['author'], oi: 'George Orwell' }, undefined, (error: unknown) => {
  //       if (error) throw error;
  //       console.log('submit succeed!');
  //       done();
  //     });
  //   });
  // }, 1000);
});
