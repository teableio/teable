import type { IEditorColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';
import type { IEditorViewOptions } from './editor-view-option.schema';

export interface IEditorView extends IViewVo {
  type: ViewType.Editor;
  options: IEditorViewOptions;
}

export class EditorViewCore extends ViewCore {
  type!: ViewType.Editor;

  options!: IEditorViewOptions;

  columnMeta!: IEditorColumnMeta;
}
