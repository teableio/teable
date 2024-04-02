import { ViewType } from '@teable/core';
import { Sheet, ClipboardList as Form } from '@teable/icons';

export const VIEW_ICON_MAP = {
  [ViewType.Grid]: Sheet,
  [ViewType.Gantt]: Sheet,
  [ViewType.Kanban]: Sheet,
  [ViewType.Gallery]: Sheet,
  [ViewType.Calendar]: Sheet,
  [ViewType.Form]: Form,
};
