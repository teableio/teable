import { SetMetadata } from '@nestjs/common';

export const IS_TOKEN_ACCESS = 'isTokenAccess';
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TokenAccess = () => SetMetadata(IS_TOKEN_ACCESS, true);
