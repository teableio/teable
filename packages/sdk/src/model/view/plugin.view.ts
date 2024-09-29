import { PluginViewCore } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { Mixin } from 'ts-mixer';
import { View } from './view';

export class PluginView extends Mixin(PluginViewCore, View) {
  async updateOption(_options: unknown): Promise<AxiosResponse<void, unknown>> {
    throw new Error('Plugin view does not support update option');
  }
}
