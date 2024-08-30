import { GalleryViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class GalleryView extends Mixin(GalleryViewCore, View) {
  async updateOption({ coverFieldId, isCoverFit, isFieldNameHidden }: GalleryView['options']) {
    return await requestWrap(updateViewOptions)(this.tableId, this.id, {
      options: { coverFieldId, isCoverFit, isFieldNameHidden },
    });
  }
}
