import {
  v2CoreTokens,
  type IBaseRepository,
  type ICommandBus,
  type IDomainWriteTransaction,
  type IQueryBus,
  type TableQueryService,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

import {
  AllowAllVcsAccessPolicy,
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
    EnableBaseVcsService,
    (dep) =>
      new EnableBaseVcsService(
        dep.resolve<IBaseRepository>(v2CoreTokens.baseRepository),
        dep.resolve<IBaseVcsLogRepository>(v2VcsServerTokens.logRepository),
        dep.resolve<IVcsAccessPolicy>(v2VcsServerTokens.accessPolicy)
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
        dep.resolve<IVcsAccessPolicy>(v2VcsServerTokens.accessPolicy)
      )
  );
  targetContainer.register(v2VcsServerTokens.pushVcsPatchService, {
    useFactory: (dep) => dep.resolve(PushVcsPatchService),
  });

  return targetContainer;
}
