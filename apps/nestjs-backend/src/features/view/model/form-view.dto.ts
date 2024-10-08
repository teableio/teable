import type { IShareViewMeta } from '@teable/core';
import { FormViewCore } from '@teable/core';

export class FormViewDto extends FormViewCore {
  defaultShareMeta: IShareViewMeta = {
    submit: {
      allow: true,
    },
  };
}
