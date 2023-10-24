/* eslint-disable @typescript-eslint/naming-convention */
import { ViewType } from '@teable-group/core';
import { Sheet, ClipboardList as Form } from '@teable-group/icons';

export const VIEW_ICON_MAP = {
  [ViewType.Grid]: Sheet,
  [ViewType.Gantt]: Sheet,
  [ViewType.Kanban]: Sheet,
  [ViewType.Gallery]: Sheet,
  [ViewType.Calendar]: Sheet,
  [ViewType.Form]: Form,
};
