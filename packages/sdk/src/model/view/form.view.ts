import { FormViewCore, ViewOpBuilder } from '@teable-group/core';
import { Mixin } from 'ts-mixer';
import { View } from './view';

export class FormView extends Mixin(FormViewCore, View) {
  async updateCover(coverUrl: string) {
    const viewOperation = ViewOpBuilder.editor.setViewOption.build({
      newOptions: {
        ...(this.options || {}),
        coverUrl,
      },
      oldOptions: this.options,
    });

    return await this.submitOperation(viewOperation);
  }
}
