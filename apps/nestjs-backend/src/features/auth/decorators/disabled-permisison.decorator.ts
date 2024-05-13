import { SetMetadata } from '@nestjs/common';

export const IS_DISABLED_PERMISSION = 'isDisabledPermission';
// eslint-disable-next-line @typescript-eslint/naming-convention
export const DisabledPermission = () => SetMetadata(IS_DISABLED_PERMISSION, true);
