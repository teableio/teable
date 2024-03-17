/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const baseConfig = registerAs('base', () => ({
  brandName: process.env.BRAND_NAME!,
  publicOrigin: process.env.PUBLIC_ORIGIN!,
  assetPrefix: process.env.ASSET_PREFIX ?? process.env.PUBLIC_ORIGIN!,
  storagePrefix: process.env.STORAGE_PREFIX ?? process.env.PUBLIC_ORIGIN!,
  secretKey: process.env.SECRET_KEY ?? 'defaultSecretKey',
  publicDatabaseAddress: process.env.PUBLIC_DATABASE_ADDRESS ?? process.env.PRISMA_DATABASE_URL,
  defaultMaxBaseDBConnections: Number(process.env.DEFAULT_MAX_BASE_DB_CONNECTIONS ?? 3),
  templateSpaceId: process.env.TEMPLATE_SPACE_ID,
}));

export const BaseConfig = () => Inject(baseConfig.KEY);

export type IBaseConfig = ConfigType<typeof baseConfig>;
