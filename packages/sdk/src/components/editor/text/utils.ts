import { SingleLineTextDisplayType } from '@teable/core';
import type { ISingleLineTextActionType } from '@teable/core';
import { openInNewTab } from '../../../utils/url';

export const onMixedTextClick = (type: ISingleLineTextActionType, text: string) => {
  const scheme = type === SingleLineTextDisplayType.Email ? 'mailto' : 'tel';
  openInNewTab(`${scheme}:${text}`);
};
