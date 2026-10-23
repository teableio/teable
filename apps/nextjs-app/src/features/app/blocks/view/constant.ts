import { ViewType } from '@teable/core';
import { Calendar, ClipboardList as Form, Component, Kanban, Sheet } from '@teable/icons';
import { GalleryHorizontal } from 'lucide-react';
import { createElement, type ComponentProps } from 'react';

const Gallery = (props: ComponentProps<typeof GalleryHorizontal>) =>
  createElement(GalleryHorizontal, { ...props, size: '1em' });

export const VIEW_ICON_MAP = {
  [ViewType.Grid]: Sheet,
  [ViewType.Kanban]: Kanban,
  [ViewType.Gallery]: Gallery,
  [ViewType.Calendar]: Calendar,
  [ViewType.Form]: Form,
  [ViewType.Plugin]: Component,
};
