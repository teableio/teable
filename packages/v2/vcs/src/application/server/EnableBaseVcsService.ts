import {
  v2CoreTokens,
  type DomainError,
  type IBaseRepository,
  type IExecutionContext,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err, type Result } from 'neverthrow';

import type { IBaseVcsLogRepository, IVcsAccessPolicy, IVcsEnableResult } from '../../ports/server';
import { v2VcsServerTokens } from '../../ports/tokens';
import { resolveExistingBase } from './serverHelpers';

export interface IEnableBaseVcsInput {
  readonly baseId: string;
}

@injectable()
export class EnableBaseVcsService {
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: IBaseRepository,
    @inject(v2VcsServerTokens.logRepository)
    private readonly logRepository: IBaseVcsLogRepository,
    @inject(v2VcsServerTokens.accessPolicy)
    private readonly accessPolicy: IVcsAccessPolicy
  ) {}

  async execute(
    ctx: IExecutionContext,
    input: IEnableBaseVcsInput
  ): Promise<Result<IVcsEnableResult, DomainError>> {
    const resolved = await resolveExistingBase(this.baseRepository, ctx, input.baseId);
    if (resolved.isErr()) {
      return err(resolved.error);
    }
    const { baseId } = resolved.value;

    const authRes = await this.accessPolicy.assertCanEnableVcs(ctx, baseId);
    if (authRes.isErr()) {
      return err(authRes.error);
    }

    return this.logRepository.enable(ctx, baseId);
  }
}
