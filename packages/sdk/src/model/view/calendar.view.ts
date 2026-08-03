import { CalendarViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class CalendarView extends Mixin(CalendarViewCore, View) {
  async updateOption({
    startDateFieldId,
    endDateFieldId,
    titleFieldId,
    colorConfig,
  }: CalendarView['options']) {
    return await requestWrap(updateViewOptions)(this.tableId, this.id, {
      options: { startDateFieldId, endDateFieldId, titleFieldId, colorConfig },
    });
  }
}
