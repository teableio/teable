'use client';

import { cn } from '@teable/ui-lib';
import { IS_APPLE } from '@udecode/plate';
import type { PlateElementProps } from '@udecode/plate/react';
import { PlateElement, useFocused, useReadOnly, useSelected } from '@udecode/plate/react';
import type { TMentionElement } from '@udecode/plate-mention';
import * as React from 'react';
import { useMounted } from './hooks/useMounted';

export function MentionElement(
  props: PlateElementProps<TMentionElement> & {
    prefix?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render?: (mentionable: any) => React.ReactNode;
  }
) {
  const element = props.element;
  const selected = useSelected();
  const focused = useFocused();
  const mounted = useMounted();
  const readOnly = useReadOnly();

  return (
    <PlateElement
      {...props}
      className={cn(
        'inline-block rounded-md bg-muted px-1.5 py-0 align-baseline text-sm font-medium mx-0.5 bg-slate-100 dark:bg-slate-800',
        !readOnly && 'cursor-pointer',
        selected && focused && 'ring-2 ring-ring',
        element.children[0].bold === true && 'font-bold',
        element.children[0].italic === true && 'italic',
        element.children[0].underline === true && 'underline'
      )}
      attributes={{
        ...props.attributes,
        contentEditable: false,
        'data-slate-value': element.value,
        draggable: true,
      }}
    >
      {mounted && IS_APPLE ? (
        // Mac OS IME https://github.com/ianstormtaylor/slate/issues/3490
        <React.Fragment>
          {props.children}
          {props.prefix}
          {props.render ? props.render(element) : element.value}
        </React.Fragment>
      ) : (
        // Others like Android https://github.com/ianstormtaylor/slate/pull/5360
        <React.Fragment>
          {props.prefix}
          {props.render ? props.render(element) : element.value}
          {props.children}
        </React.Fragment>
      )}
    </PlateElement>
  );
}
