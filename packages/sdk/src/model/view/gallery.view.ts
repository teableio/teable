import { GalleryViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';
import { enqueueViewUpdate } from './view-update-queue';

export class GalleryView extends Mixin(GalleryViewCore, View) {
  async updateOption({ coverFieldId, isCoverFit, isFieldNameHidden }: GalleryView['options']) {
    return await enqueueViewUpdate(this.id, () =>
      requestWrap(updateViewOptions)(this.tableId, this.id, {
        options: { coverFieldId, isCoverFit, isFieldNameHidden },
      })
    );
  }
}
