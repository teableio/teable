import path from 'path';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loadConfig from 'src/configs/config';

@Module({})
export class TeableConfigModule {
  static register(): DynamicModule {
    return ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: [loadConfig],
      envFilePath: ['.env.development.local', '.env.development', '.env'].map((str) => {
        const nextJsDir = loadConfig().nextJs.dir;
        const envDir = nextJsDir ? path.join(process.cwd(), nextJsDir, str) : str;
        console.log('Teable envFilePath:', envDir);
        return envDir;
      }),
    });
  }
}
