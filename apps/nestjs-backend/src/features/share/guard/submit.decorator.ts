import { SetMetadata } from '@nestjs/common';

export const IS_SHARE_SUBMIT_KEY = 'isShareSubmit';
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ShareSubmit = () => SetMetadata(IS_SHARE_SUBMIT_KEY, true);
