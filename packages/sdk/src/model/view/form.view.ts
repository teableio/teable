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

    try {
      return await new Promise((resolve, reject) => {
        this.doc.submitOp([viewOperation], undefined, (error) => {
          error ? reject(error) : resolve(undefined);
        });
      });
    } catch (error) {
      return error;
    }
  }
}
