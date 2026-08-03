import { SetMetadata } from '@nestjs/common';

export const IS_SHARE_LINK_VIEW = 'isShareLinkView';
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ShareLinkView = () => SetMetadata(IS_SHARE_LINK_VIEW, true);
