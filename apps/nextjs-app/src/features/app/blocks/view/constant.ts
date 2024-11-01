import { ViewType } from '@teable/core';
import {
  Sheet,
  ClipboardList as Form,
  LayoutGrid as Gallery,
  Kanban,
  Component,
} from '@teable/icons';

export const VIEW_ICON_MAP = {
  [ViewType.Grid]: Sheet,
  [ViewType.Gantt]: Sheet,
  [ViewType.Kanban]: Kanban,
  [ViewType.Gallery]: Gallery,
  [ViewType.Calendar]: Sheet,
  [ViewType.Form]: Form,
  [ViewType.Plugin]: Component,
};
