import { createChildContainer, type DependencyContainer } from '@teable/v2-di';

import {
  CloneBaseVcsService,
  DiffBaseVcsService,
  GetBaseVcsStatusService,
  PullBaseVcsService,
  PushBaseVcsService,
  ResolveBaseVcsConflictsService,
} from '../application/client';
import type { IVcsLocalEnginePort, IVcsRemoteGateway, IVcsStateRepository } from '../ports/client';
import { v2VcsClientTokens } from '../ports/tokens';

export interface IV2VcsClientModulePorts {
  readonly remoteGateway: IVcsRemoteGateway;
  readonly localEngine: IVcsLocalEnginePort;
  readonly stateRepository: IVcsStateRepository;
}

export function registerV2VcsClientModule(
  targetContainer: DependencyContainer,
  ports: IV2VcsClientModulePorts
): DependencyContainer {
  targetContainer.register(v2VcsClientTokens.remoteGateway, { useValue: ports.remoteGateway });
  targetContainer.register(v2VcsClientTokens.localEngine, { useValue: ports.localEngine });
  targetContainer.register(v2VcsClientTokens.stateRepository, { useValue: ports.stateRepository });

  targetContainer.register(CloneBaseVcsService, { useClass: CloneBaseVcsService });
  targetContainer.register(GetBaseVcsStatusService, { useClass: GetBaseVcsStatusService });
  targetContainer.register(DiffBaseVcsService, { useClass: DiffBaseVcsService });
  targetContainer.register(PullBaseVcsService, { useClass: PullBaseVcsService });
  targetContainer.register(ResolveBaseVcsConflictsService, {
    useClass: ResolveBaseVcsConflictsService,
  });
  targetContainer.register(PushBaseVcsService, { useClass: PushBaseVcsService });

  return targetContainer;
}

export function createV2VcsClientContainer(ports: IV2VcsClientModulePorts): DependencyContainer {
  return registerV2VcsClientModule(createChildContainer(), ports);
}
