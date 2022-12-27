import { Module } from '@nestjs/common';
import { dbPath } from '@teable-group/db-main-prisma';
import { ShareDbModule } from '../share-db/share-db.module';
import { SqliteDB } from '../share-db/sqlite.adapter';
import { WsGateway } from './ws.gateway';
import { WsService } from './ws.service';

@Module({
  imports: [
    ShareDbModule.forRoot({
      db: new SqliteDB({
        filename: dbPath,
      }),
    }),
  ],
  providers: [WsService, WsGateway],
})
export class WsModule {}
