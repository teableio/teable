import type { PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import { IBaseConfig, BaseConfig } from '../../../configs/base.config';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { AccessTokenModel } from '../../model/access-token';

export const CLOUD_ACCESS_TOKEN_TAKE_LIMIT = 100;
// Personal API keys created at or after this instant are capped on cloud.
export const CLOUD_ACCESS_TOKEN_TAKE_LIMIT_SINCE = new Date('2026-09-10T00:00:00Z');

/**
 * Cap `take` on record list requests made with a cloud API key created after
 * the cutoff. Runs after the zod pipe, so `take` is already a number. The token
 * is only looked up (cached) when the request actually exceeds the cap.
 */
@Injectable()
export class AccessTokenTakeLimitPipe<T extends { take?: number }> implements PipeTransform {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly accessTokenModel: AccessTokenModel,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  async transform(value: T): Promise<T> {
    const accessTokenId = this.cls.get('accessTokenId');
    if (
      !this.baseConfig.isCloud ||
      !accessTokenId ||
      value.take == null ||
      value.take <= CLOUD_ACCESS_TOKEN_TAKE_LIMIT
    ) {
      return value;
    }
    const token = await this.accessTokenModel.getAccessTokenRawById(accessTokenId);
    // OAuth and plugin tokens (clientId set) are re-issued on every refresh, so
    // a date cutoff would hit existing integrations; they keep the schema default.
    if (
      !token ||
      token.clientId ||
      new Date(token.createdTime) < CLOUD_ACCESS_TOKEN_TAKE_LIMIT_SINCE
    ) {
      return value;
    }
    throw new CustomHttpException(
      `This access token can't take more than ${CLOUD_ACCESS_TOKEN_TAKE_LIMIT} records per request, please reduce take count and paginate with skip`,
      HttpErrorCode.VALIDATION_ERROR
    );
  }
}
