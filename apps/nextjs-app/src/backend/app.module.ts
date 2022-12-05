import path from 'path';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import type { IAppConfig } from './app.interface';
import { AppService } from './app.service';
import { FileTreeModule } from './features/file-tree/file-tree.module';

@Module({})
export class AppModule {
  static forRoot(config: IAppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          envFilePath: [
            '.env.development.local',
            '.env.development',
            '.env',
          ].map((str) => {
            return config.dir ? path.join(config.dir, str) : str;
          }),
        }),
        FileTreeModule,
      ],
      controllers: [AppController],
      providers: [{ provide: 'APP_CONFIG', useValue: config }, AppService],
    };
  }
}
