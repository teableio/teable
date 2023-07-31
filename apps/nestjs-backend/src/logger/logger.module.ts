import type { DynamicModule } from '@nestjs/common';
import { Module, RequestMethod } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { X_REQUEST_ID } from '../const';

@Module({})
export class TeableLoggerModule {
  static register(): DynamicModule {
    return LoggerModule.forRootAsync({
      inject: [ClsService],
      useFactory: (cls: ClsService) => {
        return {
          pinoHttp: {
            name: 'teable',
            level: 'info',
            quietReqLogger: true,
            genReqId: (req, res) => {
              const existingID = req.id ?? req.headers[X_REQUEST_ID];
              if (existingID) return existingID;
              const id = cls.getId();
              res.setHeader(X_REQUEST_ID, id);
              return id;
            },
            transport:
              process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
          },
          exclude: [
            '_next/(.*)',
            '__nextjs(.*)',
            'images/(.*)',
            'favicon.ico',
            {
              path: 'space/(.*)?',
              method: RequestMethod.GET,
            },
          ],
        };
      },
    });
  }
}
