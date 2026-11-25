import {
  v2CoreTokens,
  type IBaseRepository,
  type ICommandBus,
  type IDomainWriteTransaction,
  type IQueryBus,
  type IRecordOrderColumnPreparer,
  type ITableRecordQueryRepository,
  type ITableRepository,
  type ITableSchemaCoordination,
  type TableQueryService,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

import {
  AllowAllVcsAccessPolicy,
  BaseVcsHistoryService,
  CloneVcsSnapshotService,
  EnableBaseVcsService,
  GetVcsHeadService,
  ListVcsChangesService,
  ListVcsTableRecordsChunkService,
  PushVcsPatchService,
} from '../application/server';
import type { IBaseVcsLogRepository, IVcsAccessPolicy } from '../ports/server';
import { v2VcsServerTokens } from '../ports/tokens';
import { BaseVcsChangeLogProjection } from '../projections/BaseVcsChangeLogProjection';
import { BaseVcsCheckpointReader } from '../snapshot/BaseVcsCheckpointReader';

const registerSingletonFactory = <T>(
  targetContainer: DependencyContainer,
  token: Parameters<DependencyContainer['register']>[0],
  create: (dep: DependencyContainer) => T
): void => {
  let instance: T | undefined;
  targetContainer.register(token, {
    useFactory: (dep) => {
      if (!instance) {
        instance = create(dep);
      }
      return instance;
    },
  });
};

export function registerV2VcsServerModule(
  targetContainer: DependencyContainer
): DependencyContainer {
  if (!targetContainer.isRegistered(v2VcsServerTokens.accessPolicy)) {
    registerSingletonFactory<IVcsAccessPolicy>(
      targetContainer,
      v2VcsServerTokens.accessPolicy,
      (dep) => new AllowAllVcsAccessPolicy(dep.resolve<IQueryBus>(v2CoreTokens.queryBus))
    );
  }

  registerSingletonFactory(targetContainer, BaseVcsChangeLogProjection, (dep) => {
    const logRepository = dep.resolve<IBaseVcsLogRepository>(v2VcsServerTokens.logRepository);
    const tableQueryService = dep.isRegistered(v2CoreTokens.tableQueryService)
      ? dep.resolve<TableQueryService>(v2CoreTokens.tableQueryService)
      : undefined;
    return new BaseVcsChangeLogProjection(logRepository, tableQueryService);
  });

  registerSingletonFactory(
    targetContainer,
    BaseVcsCheckpointReader,
    (dep) =>
      new BaseVcsCheckpointReader(
        dep.resolve<IBaseRepository>(v2CoreTokens.baseRepository),
        dep.resolve<ITableRepository>(v2CoreTokens.tableRepository),
        dep.resolve<ITableRecordQueryRepository>(v2CoreTokens.tableRecordQueryRepository)
      )
  );

  registerSingletonFactory(
    targetContainer,
    EnableBaseVcsService,
    (dep) =>
      new EnableBaseVcsService(
        dep.resolve<IBaseRepository>(v2CoreTokens.baseRepository),
        dep.resolve<IBaseVcsLogRepository>(v2VcsServerTokens.logRepository),
        dep.resolve<IVcsAccessPolicy>(v2VcsServerTokens.accessPolicy),
        dep.resolve(BaseVcsCheckpointReader)
      )
  );
  targetContainer.register(v2VcsServerTokens.enableBaseVcsService, {
    useFactory: (dep) => dep.resolve(EnableBaseVcsService),
  });

  registerSingletonFactory(
    targetContainer,
    GetVcsHeadService,
    (dep) =>
      new GetVcsHeadService(
        dep.resolve<IBaseRepository>(v2CoreTokens.baseRepository),
        dep.resolve<IBaseVcsLogRepository>(v2VcsServerTokens.logRepository)
      )
  );
  targetContainer.register(v2VcsServerTokens.getVcsHeadService, {
    useFactory: (dep) => dep.resolve(GetVcsHeadService),
  });

  registerSingletonFactory(
    targetContainer,
    CloneVcsSnapshotService,
    (dep) =>
      new CloneVcsSnapshotService(
        dep.resolve<IBaseRepository>(v2CoreTokens.baseRepository),
        dep.resolve<IQueryBus>(v2CoreTokens.queryBus),
        dep.resolve<IBaseVcsLogRepository>(v2VcsServerTokens.logRepository),
        dep.resolve<IVcsAccessPolicy>(v2VcsServerTokens.accessPolicy)
      )
  );
  targetContainer.register(v2VcsServerTokens.cloneVcsSnapshotService, {
    useFactory: (dep) => dep.resolve(CloneVcsSnapshotService),
  });

  registerSingletonFactory(
    targetContainer,
    ListVcsChangesService,
    (dep) =>
      new ListVcsChangesService(
        dep.resolve<IBaseRepository>(v2CoreTokens.baseRepository),
        dep.resolve<IQueryBus>(v2CoreTokens.queryBus),
        dep.resolve<IBaseVcsLogRepository>(v2VcsServerTokens.logRepository),
        dep.resolve<IVcsAccessPolicy>(v2VcsServerTokens.accessPolicy),
        dep.resolve(CloneVcsSnapshotService)
      )
  );
  targetContainer.register(v2VcsServerTokens.listVcsChangesService, {
    useFactory: (dep) => dep.resolve(ListVcsChangesService),
  });

  registerSingletonFactory(
    targetContainer,
    ListVcsTableRecordsChunkService,
    (dep) =>
      new ListVcsTableRecordsChunkService(
        dep.resolve<IBaseRepository>(v2CoreTokens.baseRepository),
        dep.resolve<IQueryBus>(v2CoreTokens.queryBus),
        dep.resolve<IVcsAccessPolicy>(v2VcsServerTokens.accessPolicy)
      )
  );
  targetContainer.register(v2VcsServerTokens.listVcsTableRecordsChunkService, {
    useFactory: (dep) => dep.resolve(ListVcsTableRecordsChunkService),
  });

  registerSingletonFactory(
    targetContainer,
    PushVcsPatchService,
    (dep) =>
      new PushVcsPatchService(
        dep.resolve<IBaseRepository>(v2CoreTokens.baseRepository),
        dep.resolve<ICommandBus>(v2CoreTokens.commandBus),
        dep.resolve<IQueryBus>(v2CoreTokens.queryBus),
        dep.resolve<IDomainWriteTransaction>(v2CoreTokens.domainWriteTransaction),
        dep.resolve<IBaseVcsLogRepository>(v2VcsServerTokens.logRepository),
        dep.resolve<IVcsAccessPolicy>(v2VcsServerTokens.accessPolicy),
        dep.resolve(BaseVcsCheckpointReader),
        dep.resolve<IRecordOrderColumnPreparer>(v2CoreTokens.recordOrderColumnPreparer),
        dep.resolve<ITableRepository>(v2CoreTokens.tableRepository),
        dep.resolve<ITableSchemaCoordination>(v2CoreTokens.tableSchemaCoordination)
      )
  );
  targetContainer.register(v2VcsServerTokens.pushVcsPatchService, {
    useFactory: (dep) => dep.resolve(PushVcsPatchService),
  });

  registerSingletonFactory(
    targetContainer,
    BaseVcsHistoryService,
    (dep) =>
      new BaseVcsHistoryService(
        dep.resolve<IBaseVcsLogRepository>(v2VcsServerTokens.logRepository),
        dep.resolve<IVcsAccessPolicy>(v2VcsServerTokens.accessPolicy),
        dep.resolve<IQueryBus>(v2CoreTokens.queryBus),
        dep.resolve(BaseVcsCheckpointReader),
        dep.resolve<IDomainWriteTransaction>(v2CoreTokens.domainWriteTransaction),
        dep.resolve(PushVcsPatchService),
        dep.resolve<ITableRepository>(v2CoreTokens.tableRepository)
      )
  );
  targetContainer.register(v2VcsServerTokens.historyService, {
    useFactory: (dep) => dep.resolve(BaseVcsHistoryService),
  });

  return targetContainer;
}
