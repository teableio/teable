import type { IFormViewOptions, IPluginViewOptions, IViewVo } from '@teable/core';
import { ViewType } from '@teable/core';
import { getPublicFullStorageUrl } from '../features/attachments/plugins/utils';

// The value may already be a full URL: the v2 view read path converts before the
// share layer converts again, and users can store external image URLs directly.
// Stored storage paths are always relative (e.g. `form/xxx`), so an absolute URL
// must pass through untouched instead of getting the storage prefix twice.
const toFullStorageUrl = (path: string) =>
  /^https?:\/\//i.test(path) ? path : getPublicFullStorageUrl(path);

export const convertViewVoAttachmentUrl = (viewVo: IViewVo) => {
  if (viewVo.type === ViewType.Form) {
    const formOptions = viewVo.options as IFormViewOptions;
    if (formOptions?.coverUrl) {
      formOptions.coverUrl = toFullStorageUrl(formOptions.coverUrl);
    }
    if (formOptions?.logoUrl) {
      formOptions.logoUrl = toFullStorageUrl(formOptions.logoUrl);
    }
  }
  if (viewVo.type === ViewType.Plugin) {
    const pluginOptions = viewVo.options as IPluginViewOptions;
    if (pluginOptions?.pluginLogo) {
      pluginOptions.pluginLogo = toFullStorageUrl(pluginOptions.pluginLogo);
    }
  }
  return viewVo;
};
