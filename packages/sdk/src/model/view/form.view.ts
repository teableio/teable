import { FormViewCore } from '@teable-group/core';
import { setViewOption } from '@teable-group/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class FormView extends Mixin(FormViewCore, View) {
  async updateCover(tableId: string, coverUrl: string) {
    return await requestWrap(setViewOption)(tableId, this.id, { coverUrl });
  }
}
