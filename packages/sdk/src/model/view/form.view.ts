import { FormViewCore } from '@teable-group/core';
import { setViewOption } from '@teable-group/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class FormView extends Mixin(FormViewCore, View) {
  async setOption({ coverUrl }: FormView['options']) {
    return await requestWrap(setViewOption)(this.tableId, this.id, { coverUrl });
  }
}
