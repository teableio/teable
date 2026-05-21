import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateSpaceRo, IDataDbPreflightRo, IDataDbPreflightVo } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { DataDbBaselineService } from './data-db-baseline.service';
import { resolveDataDbInternalSchema } from './data-db-internal-schema';
import { DataDbMigrationService } from './data-db-migration.service';
import {
  DataDbPreflightService,
  fingerprintDataDbConnection,
  getDatabaseUrlDisplayParts,
} from './data-db-preflight.service';
import { decryptDataDbUrl, encryptDataDbUrl } from './data-db-url-secret';

type IDataDbCreateOptions = NonNullable<ICreateSpaceRo['dataDb']>;
type IPreparedDataDbBinding = {
  encryptedUrl: string;
  urlFingerprint: string;
  displayHost: string;
  displayDatabase: string;
  internalSchema: string;
  schemaVersion: string | null;
  capabilities: IDataDbPreflightVo['capabilities'];
};

const initializeEmptyTargetMode = 'initialize-empty';
const adoptExistingTargetMode = 'adopt-existing';
const dataDbUrlRequiredError = 'Data database URL is required';

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
    private readonly baselineService: DataDbBaselineService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly dataDbMigrationService?: DataDbMigrationService
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

    if (dataDb.targetMode && dataDb.targetMode !== initializeEmptyTargetMode) {
      throw new CustomHttpException(
        'Only initialize-empty BYODB target mode is supported for new spaces',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    if (!dataDb.url) {
      throw new CustomHttpException(dataDbUrlRequiredError, HttpErrorCode.VALIDATION_ERROR);
    }

    return await this.prepareByodbBinding(
      {
        url: dataDb.url,
        targetMode: dataDb.targetMode ?? initializeEmptyTargetMode,
        internalSchema: dataDb.internalSchema,
      },
      dataDb.targetMode ?? initializeEmptyTargetMode
    );
  }

  async createPreparedBindingForNewSpace(
    spaceId: string,
    createdBy: string,
    prepared: IPreparedDataDbBinding | null
  ) {
    if (!prepared) {
      return;
    }

    let connectionId: string | undefined;
    await this.prismaService.$tx(async (prisma) => {
      const connection = await prisma.dataDbConnection.upsert({
        where: { urlFingerprint: prepared.urlFingerprint },
        create: {
          provider: 'postgres',
          encryptedUrl: prepared.encryptedUrl,
          urlFingerprint: prepared.urlFingerprint,
          displayHost: prepared.displayHost,
          displayDatabase: prepared.displayDatabase,
          internalSchema: prepared.internalSchema,
          status: 'ready',
          schemaVersion: prepared.schemaVersion,
          capabilities: prepared.capabilities,
          lastValidatedAt: new Date(),
          createdBy,
        },
        update: {
          encryptedUrl: prepared.encryptedUrl,
          displayHost: prepared.displayHost,
          displayDatabase: prepared.displayDatabase,
          internalSchema: prepared.internalSchema,
          status: 'ready',
          schemaVersion: prepared.schemaVersion,
          capabilities: prepared.capabilities,
          lastValidatedAt: new Date(),
          lastError: null,
        },
        select: { id: true },
      });
      connectionId = connection.id;

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
    if (connectionId) {
      await this.dataDbClientManager.invalidateConnection(connectionId);
    }
  }

  async retestBinding(spaceId: string) {
    const binding = await this.getByodbBinding(spaceId);
    const connection = binding.dataDbConnection;
    const url = decryptDataDbUrl(connection.encryptedUrl);
    const preflight = await this.preflightService.preflight({
      url,
      targetMode: initializeEmptyTargetMode,
      internalSchema: connection.internalSchema,
    });

    await this.prismaService.$tx(async (prisma) => {
      await prisma.dataDbConnection.update({
        where: { id: connection.id },
        data: {
          status: preflight.ok ? 'ready' : 'error',
          capabilities: preflight.capabilities,
          lastValidatedAt: new Date(),
          lastError: preflight.ok ? null : buildPreflightErrorMessage(preflight),
        },
      });
      await prisma.spaceDataDbBinding.updateMany({
        where: { dataDbConnectionId: connection.id, mode: 'byodb' },
        data: { state: preflight.ok ? 'ready' : 'error' },
      });
    });

    return preflight;
  }

  async retryMigrationForSpace(spaceId: string) {
    if (!this.dataDbMigrationService) {
      throw new CustomHttpException(
        'Data database migration service is unavailable',
        HttpErrorCode.CONFLICT
      );
    }

    const binding = await this.getByodbBinding(spaceId);
    const connection = binding.dataDbConnection;
    const applied = await this.dataDbMigrationService.ensureConnectionMigrated({
      connectionId: connection.id,
      internalSchema: connection.internalSchema,
      url: decryptDataDbUrl(connection.encryptedUrl),
    });
    await this.dataDbClientManager.invalidateConnection(connection.id);
    return applied;
  }

  async updateBindingForSpace(spaceId: string, updatedBy: string, dataDb: IDataDbPreflightRo) {
    if (!dataDb.url) {
      throw new CustomHttpException(dataDbUrlRequiredError, HttpErrorCode.VALIDATION_ERROR);
    }

    const binding = await this.prismaService.spaceDataDbBinding.findUnique({
      where: { spaceId },
      include: { dataDbConnection: true },
    });
    if (binding?.mode !== 'byodb' || !binding.dataDbConnection?.encryptedUrl) {
      if (dataDb.targetMode === adoptExistingTargetMode) {
        await this.createBindingForExistingSpace(spaceId, updatedBy, dataDb);
        return;
      }

      throw new CustomHttpException(
        'BYODB data database binding was not found',
        HttpErrorCode.NOT_FOUND
      );
    }

    const current = binding.dataDbConnection;
    const internalSchema = resolveDataDbInternalSchema(
      dataDb.internalSchema ?? current.internalSchema,
      dataDb.url
    );
    const nextDisplayParts = getDatabaseUrlDisplayParts(dataDb.url);

    if (
      current.internalSchema !== internalSchema ||
      current.displayHost !== nextDisplayParts.displayHost ||
      current.displayDatabase !== nextDisplayParts.displayDatabase
    ) {
      throw new CustomHttpException(
        'Changing the BYODB database or internal schema is not supported yet',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const preflight = await this.preflightService.preflight({
      url: dataDb.url,
      targetMode: initializeEmptyTargetMode,
      internalSchema,
    });
    if (!preflight.ok) {
      throw new CustomHttpException(buildPreflightErrorMessage(preflight), HttpErrorCode.CONFLICT, {
        preflight,
      });
    }

    const schemaVersion = await this.baselineService.initialize(dataDb.url, internalSchema);
    await this.prismaService.dataDbConnection.update({
      where: { id: current.id },
      data: {
        encryptedUrl: encryptDataDbUrl(dataDb.url),
        urlFingerprint: fingerprintDataDbConnection(dataDb.url, internalSchema),
        status: 'ready',
        schemaVersion,
        capabilities: preflight.capabilities,
        lastValidatedAt: new Date(),
        lastError: null,
        createdBy: current.createdBy ?? updatedBy,
      },
    });
    await this.prismaService.spaceDataDbBinding.updateMany({
      where: { dataDbConnectionId: current.id, mode: 'byodb' },
      data: { state: 'ready' },
    });
    await this.dataDbClientManager.invalidateConnection(current.id);
  }

  async createBindingForExistingSpace(
    spaceId: string,
    createdBy: string,
    dataDb: IDataDbPreflightRo
  ) {
    if (dataDb.targetMode !== adoptExistingTargetMode) {
      throw new CustomHttpException(
        'Only adopt-existing BYODB target mode is supported for existing spaces',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const prepared = await this.prepareByodbBinding(dataDb, adoptExistingTargetMode);
    let connectionId: string | undefined;
    await this.prismaService.$tx(async (prisma) => {
      const connection = await prisma.dataDbConnection.upsert({
        where: { urlFingerprint: prepared.urlFingerprint },
        create: {
          provider: 'postgres',
          encryptedUrl: prepared.encryptedUrl,
          urlFingerprint: prepared.urlFingerprint,
          displayHost: prepared.displayHost,
          displayDatabase: prepared.displayDatabase,
          internalSchema: prepared.internalSchema,
          status: 'ready',
          schemaVersion: prepared.schemaVersion,
          capabilities: prepared.capabilities,
          lastValidatedAt: new Date(),
          createdBy,
        },
        update: {
          encryptedUrl: prepared.encryptedUrl,
          displayHost: prepared.displayHost,
          displayDatabase: prepared.displayDatabase,
          internalSchema: prepared.internalSchema,
          status: 'ready',
          schemaVersion: prepared.schemaVersion,
          capabilities: prepared.capabilities,
          lastValidatedAt: new Date(),
          lastError: null,
        },
        select: { id: true },
      });
      connectionId = connection.id;

      await prisma.spaceDataDbBinding.upsert({
        where: { spaceId },
        create: {
          spaceId,
          dataDbConnectionId: connection.id,
          mode: 'byodb',
          state: 'ready',
          createdBy,
        },
        update: {
          dataDbConnectionId: connection.id,
          mode: 'byodb',
          state: 'ready',
        },
      });
    });
    if (connectionId) {
      await this.dataDbClientManager.invalidateConnection(connectionId);
    }
  }

  private async prepareByodbBinding(
    dataDb: IDataDbPreflightRo,
    targetMode: IDataDbPreflightRo['targetMode']
  ): Promise<IPreparedDataDbBinding> {
    const internalSchema = resolveDataDbInternalSchema(dataDb.internalSchema, dataDb.url);
    const preflight = await this.preflightService.preflight({
      url: dataDb.url,
      targetMode,
      internalSchema,
    });
    if (!preflight.ok) {
      throw new CustomHttpException(buildPreflightErrorMessage(preflight), HttpErrorCode.CONFLICT, {
        preflight,
      });
    }

    const schemaVersion = await this.baselineService.initialize(dataDb.url, internalSchema);

    const { displayHost, displayDatabase } = getDatabaseUrlDisplayParts(dataDb.url);
    return {
      encryptedUrl: encryptDataDbUrl(dataDb.url),
      urlFingerprint: fingerprintDataDbConnection(dataDb.url, internalSchema),
      displayHost,
      displayDatabase,
      internalSchema,
      schemaVersion,
      capabilities: preflight.capabilities,
    };
  }

  private async getByodbBinding(spaceId: string) {
    const binding = await this.prismaService.spaceDataDbBinding.findUnique({
      where: { spaceId },
      include: { dataDbConnection: true },
    });
    if (binding?.mode !== 'byodb' || !binding.dataDbConnection?.encryptedUrl) {
      throw new CustomHttpException(
        'BYODB data database binding was not found',
        HttpErrorCode.NOT_FOUND
      );
    }
    return binding as typeof binding & {
      dataDbConnection: NonNullable<typeof binding.dataDbConnection>;
    };
  }
}
