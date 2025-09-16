import type { Action, IFieldVo } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import type { ClsStore } from 'nestjs-cls';
import type { IPerformanceCacheStore } from '../performance-cache';
import type { IRawOpMap } from '../share-db/interface';
import type { IDataLoaderCache } from './data-loader';

export interface IClsStore extends ClsStore {
  user: {
    id: string;
    name: string;
    email: string;
    isAdmin?: boolean | null;
  };
  accessTokenId?: string;
  entry?: {
    type: string;
    id: string;
  };
  origin: {
    ip: string;
    byApi: boolean;
    userAgent: string;
    referer: string;
  };
  tx: {
    client?: Prisma.TransactionClient;
    timeStr?: string;
    id?: string;
    rawOpMaps?: IRawOpMap[];
  };
  shareViewId?: string;
  permissions: Action[];
  // for share db adapter
  cookie?: string;
  oldField?: IFieldVo;
  organization?: {
    id: string;
    name: string;
    isAdmin: boolean;
    departments?: {
      id: string;
      name: string;
    }[];
  };
  tempAuthBaseId?: string; // for automation robot
  dataLoaderCache?: IDataLoaderCache;
  clearCacheKeys?: (keyof IPerformanceCacheStore)[];
}
