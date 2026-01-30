import { EditorViewCore } from '@teable/core';
import { updateViewOptions } from '@teable/openapi';
import { Mixin } from 'ts-mixer';
import { requestWrap } from '../../utils/requestWrap';
import { View } from './view';

export class EditorView extends Mixin(EditorViewCore, View) {
  async updateOption({ editorFieldId }: EditorView['options']) {
    return await requestWrap(updateViewOptions)(this.tableId, this.id, {
      options: { editorFieldId },
    });
  }
}
