import { KanbanViewCore } from '@teable-group/core';
import type { AxiosResponse } from 'axios';
import { Mixin } from 'ts-mixer';
import { View } from './view';

export class KanbanView extends Mixin(KanbanViewCore, View) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setOption(): Promise<AxiosResponse<void, any>> {
    throw new Error('setOption is not implemented for KanbanView');
  }
}
