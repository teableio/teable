import { Module } from '@nestjs/common';
import { ShareDbModule } from '../share-db/share-db.module';
import { WsGateway } from './ws.gateway';
import { WsService } from './ws.service';

@Module({
  imports: [ShareDbModule],
  providers: [WsService, WsGateway],
})
export class WsModule {}
