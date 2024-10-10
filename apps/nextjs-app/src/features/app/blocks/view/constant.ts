import { ViewType } from '@teable/core';
import { Sheet, ClipboardList as Form, Kanban, Code } from '@teable/icons';

export const VIEW_ICON_MAP = {
  [ViewType.Grid]: Sheet,
  [ViewType.Gantt]: Sheet,
  [ViewType.Kanban]: Kanban,
  [ViewType.Gallery]: Sheet,
  [ViewType.Calendar]: Sheet,
  [ViewType.Form]: Form,
  [ViewType.Plugin]: Code,
};
