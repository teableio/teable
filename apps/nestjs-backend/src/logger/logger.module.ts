import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

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
            autoLogging: false,
            quietReqLogger: true,
            genReqId: (req, res) => {
              const existingID = req.id ?? req.headers['X-Request-Id'];
              if (existingID) return existingID;
              const id = cls.getId();
              res.setHeader('X-Request-Id', id);
              return id;
            },
            transport:
              process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
          },
        };
      },
    });
  }
}
