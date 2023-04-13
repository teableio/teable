import path from 'path';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { IAppConfig } from '../../app.interface';
import loadConfig from '../../configs/config';
import { NextController } from './next.controller';
import { NextService } from './next.service';

@Module({})
export class NextModule {
  static forRoot(config: IAppConfig): DynamicModule {
    this.DEFAULT = {
      module: NextModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.development.local', '.env.development', '.env'].map((str) => {
            const envDir = config.dir ? path.join(process.cwd(), config.dir, str) : str;
            console.log('envDir:', envDir);
            return envDir;
          }),
          load: [loadConfig],
        }),
      ],
      providers: [{ provide: 'APP_CONFIG', useValue: config }, NextService],
      controllers: [NextController],
    };
    return this.DEFAULT;
  }

  public static DEFAULT: DynamicModule;
}
