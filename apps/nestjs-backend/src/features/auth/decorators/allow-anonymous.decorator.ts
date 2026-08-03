import { SetMetadata } from '@nestjs/common';

export enum AllowAnonymousType {
  RESOURCE = 'resource',
  USER = 'user',
  PUBLIC = 'public',
}

export const IS_ALLOW_ANONYMOUS = 'isAllowAnonymous';
// eslint-disable-next-line @typescript-eslint/naming-convention
export const AllowAnonymous = (type: AllowAnonymousType = AllowAnonymousType.RESOURCE) =>
  SetMetadata(IS_ALLOW_ANONYMOUS, type);
