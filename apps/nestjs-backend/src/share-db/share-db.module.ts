import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { IShareDbConfig } from './interface';
import { ShareDb } from './share-db';

@Module({})
export class ShareDbModule {
  static forRoot(config: IShareDbConfig): DynamicModule {
    return {
      module: ShareDbModule,
      providers: [{ provide: 'SHAREDB_CONFIG', useValue: config }, ShareDb],
      exports: [ShareDb],
    };
  }
}
