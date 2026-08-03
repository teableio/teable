import { SetMetadata } from '@nestjs/common';

export const ENSURE_LOGIN = 'ensureLogin';
// eslint-disable-next-line @typescript-eslint/naming-convention
export const EnsureLogin = () => SetMetadata(ENSURE_LOGIN, true);
