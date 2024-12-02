import { ViewType } from '@teable/core';
import { Sheet, ClipboardList as Form, Kanban, Component, Calendar } from '@teable/icons';

export const VIEW_ICON_MAP: Record<ViewType, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  [ViewType.Grid]: Sheet,
  [ViewType.Gantt]: Sheet,
  [ViewType.Kanban]: Kanban,
  [ViewType.Gallery]: Sheet,
  [ViewType.Calendar]: Calendar,
  [ViewType.Form]: Form,
  [ViewType.Plugin]: Component,
};
