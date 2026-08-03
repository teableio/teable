import { Module } from '@nestjs/common';
import { ShareDbModule } from '../share-db/share-db.module';
import { WsGateway } from './ws.gateway';
import { DevWsGateway } from './ws.gateway.dev';
import { WsService } from './ws.service';

@Module({
  imports: [ShareDbModule],
  providers: [
    WsService,
    process.env.NODE_ENV === 'production' || process.env.SERVER_PORT === process.env.SOCKET_PORT
      ? WsGateway
      : DevWsGateway,
  ],
})
export class WsModule {}
