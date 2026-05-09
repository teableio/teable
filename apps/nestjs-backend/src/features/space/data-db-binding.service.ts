import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateSpaceRo, IDataDbPreflightVo } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { DataDbBaselineService } from './data-db-baseline.service';
import {
  DataDbPreflightService,
  fingerprintDatabaseUrl,
  getDatabaseUrlDisplayParts,
} from './data-db-preflight.service';
import { encryptDataDbUrl } from './data-db-url-secret';

type IDataDbCreateOptions = NonNullable<ICreateSpaceRo['dataDb']>;
type IPreparedDataDbBinding = {
  encryptedUrl: string;
  urlFingerprint: string;
  displayHost: string;
  displayDatabase: string;
  capabilities: IDataDbPreflightVo['capabilities'];
};

const buildPreflightErrorMessage = (preflight: IDataDbPreflightVo) => {
  const errorCodes = preflight.errors.map((error) => error.code).join(', ');
  return errorCodes
    ? `Data database preflight failed: ${errorCodes}`
    : `Data database preflight failed: ${preflight.classification}`;
};

@Injectable()
export class DataDbBindingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly preflightService: DataDbPreflightService,
    private readonly baselineService: DataDbBaselineService
  ) {}

  async createBindingForNewSpace(
    spaceId: string,
    createdBy: string,
    dataDb?: IDataDbCreateOptions
  ) {
    const prepared = await this.prepareBindingForNewSpace(dataDb);
    await this.createPreparedBindingForNewSpace(spaceId, createdBy, prepared);
  }

  async prepareBindingForNewSpace(
    dataDb?: IDataDbCreateOptions
  ): Promise<IPreparedDataDbBinding | null> {
    if (!dataDb || dataDb.mode === 'default') {
      return null;
    }

    if (dataDb.targetMode && dataDb.targetMode !== 'initialize-empty') {
      throw new CustomHttpException(
        'Only initialize-empty BYODB target mode is supported for new spaces',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    if (!dataDb.url) {
      throw new CustomHttpException(
        'Data database URL is required',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const preflight = await this.preflightService.preflight({
      url: dataDb.url,
      targetMode: dataDb.targetMode ?? 'initialize-empty',
    });
    if (!preflight.ok) {
      throw new CustomHttpException(buildPreflightErrorMessage(preflight), HttpErrorCode.CONFLICT, {
        preflight,
      });
    }

    await this.baselineService.initialize(dataDb.url);

    const { displayHost, displayDatabase } = getDatabaseUrlDisplayParts(dataDb.url);
    return {
      encryptedUrl: encryptDataDbUrl(dataDb.url),
      urlFingerprint: fingerprintDatabaseUrl(dataDb.url),
      displayHost,
      displayDatabase,
      capabilities: preflight.capabilities,
    };
  }

  async createPreparedBindingForNewSpace(
    spaceId: string,
    createdBy: string,
    prepared: IPreparedDataDbBinding | null
  ) {
    if (!prepared) {
      return;
    }

    await this.prismaService.$tx(async (prisma) => {
      const connection = await prisma.dataDbConnection.upsert({
        where: { urlFingerprint: prepared.urlFingerprint },
        create: {
          provider: 'postgres',
          encryptedUrl: prepared.encryptedUrl,
          urlFingerprint: prepared.urlFingerprint,
          displayHost: prepared.displayHost,
          displayDatabase: prepared.displayDatabase,
          status: 'ready',
          capabilities: prepared.capabilities,
          lastValidatedAt: new Date(),
          createdBy,
        },
        update: {
          encryptedUrl: prepared.encryptedUrl,
          displayHost: prepared.displayHost,
          displayDatabase: prepared.displayDatabase,
          status: 'ready',
          capabilities: prepared.capabilities,
          lastValidatedAt: new Date(),
          lastError: null,
        },
        select: { id: true },
      });

      await prisma.spaceDataDbBinding.create({
        data: {
          spaceId,
          dataDbConnectionId: connection.id,
          mode: 'byodb',
          state: 'ready',
          createdBy,
        },
      });
    });
  }
}
