import type { IFormViewOptions, IPluginViewOptions, IViewVo } from '@teable/core';
import { ViewType } from '@teable/core';
import { getPublicFullStorageUrl } from '../features/attachments/plugins/utils';

export const convertViewVoAttachmentUrl = (viewVo: IViewVo) => {
  if (viewVo.type === ViewType.Form) {
    const formOptions = viewVo.options as IFormViewOptions;
    formOptions?.coverUrl &&
      (formOptions.coverUrl = formOptions.coverUrl
        ? getPublicFullStorageUrl(formOptions.coverUrl)
        : undefined);
    formOptions?.logoUrl &&
      (formOptions.logoUrl = formOptions.logoUrl
        ? getPublicFullStorageUrl(formOptions.logoUrl)
        : undefined);
  }
  if (viewVo.type === ViewType.Plugin) {
    const pluginOptions = viewVo.options as IPluginViewOptions;
    pluginOptions.pluginLogo = getPublicFullStorageUrl(pluginOptions.pluginLogo);
  }
  return viewVo;
};
