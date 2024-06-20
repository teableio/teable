/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const baseConfig = registerAs('base', () => ({
  brandName: process.env.BRAND_NAME!,
  publicOrigin: process.env.PUBLIC_ORIGIN!,
  storagePrefix: process.env.STORAGE_PREFIX ?? process.env.PUBLIC_ORIGIN!,
  secretKey: process.env.SECRET_KEY ?? 'defaultSecretKey',
  publicDatabaseProxy: process.env.PUBLIC_DATABASE_PROXY,
  defaultMaxBaseDBConnections: Number(process.env.DEFAULT_MAX_BASE_DB_CONNECTIONS ?? 3),
  templateSpaceId: process.env.TEMPLATE_SPACE_ID,
}));

export const BaseConfig = () => Inject(baseConfig.KEY);

export type IBaseConfig = ConfigType<typeof baseConfig>;
