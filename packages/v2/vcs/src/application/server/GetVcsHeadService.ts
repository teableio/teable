import {
  v2CoreTokens,
  type DomainError,
  type IBaseRepository,
  type IExecutionContext,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import type { IVcsHeadInfo } from '../../domain/types';
import type { IBaseVcsLogRepository } from '../../ports/server';
import { v2VcsServerTokens } from '../../ports/tokens';
import { resolveExistingBase } from './serverHelpers';

export interface IGetVcsHeadInput {
  readonly baseId: string;
}

@injectable()
export class GetVcsHeadService {
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: IBaseRepository,
    @inject(v2VcsServerTokens.logRepository)
    private readonly logRepository: IBaseVcsLogRepository
  ) {}

  async execute(
    ctx: IExecutionContext,
    input: IGetVcsHeadInput
  ): Promise<Result<IVcsHeadInfo, DomainError>> {
    const resolved = await resolveExistingBase(this.baseRepository, ctx, input.baseId);
    if (resolved.isErr()) {
      return err(resolved.error);
    }

    const headRes = await this.logRepository.getHead(ctx, resolved.value.baseId);
    if (headRes.isErr()) {
      return err(headRes.error);
    }

    return ok({
      baseId: resolved.value.baseId.toString(),
      baseName: resolved.value.base.name().toString(),
      headRevision: headRes.value.headRevision,
      vcsEnabled: headRes.value.enabled,
      remoteMode: 'v2-vcs',
    });
  }
}
