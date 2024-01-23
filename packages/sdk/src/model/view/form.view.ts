import { FormViewCore } from '@teable-group/core';
import { updateViewOptions } from '@teable-group/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class FormView extends Mixin(FormViewCore, View) {
  async updateOption({ coverUrl }: FormView['options']) {
    return await requestWrap(updateViewOptions)(this.tableId, this.id, { options: { coverUrl } });
  }
}
