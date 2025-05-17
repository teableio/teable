import { cn } from '@teable/ui-lib';
import type { SlateElementProps } from '@udecode/plate';
import { IS_APPLE, SlateElement } from '@udecode/plate';
import type { TMentionElement } from '@udecode/plate-mention';

import * as React from 'react';

export function MentionElementStatic(
  props: SlateElementProps<TMentionElement> & {
    prefix?: string;
  }
) {
  const { prefix } = props;
  const element = props.element;

  return (
    <SlateElement
      className={cn(
        'inline-block rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm font-medium',
        element.children[0].bold === true && 'font-bold',
        element.children[0].italic === true && 'italic',
        element.children[0].underline === true && 'underline'
      )}
      data-slate-value={element.value}
      {...props}
    >
      {IS_APPLE ? (
        // Mac OS IME https://github.com/ianstormtaylor/slate/issues/3490
        <React.Fragment>
          {props.children}
          {prefix}
          {element.value}
        </React.Fragment>
      ) : (
        // Others like Android https://github.com/ianstormtaylor/slate/pull/5360
        <React.Fragment>
          {prefix}
          {element.value}
          {props.children}
        </React.Fragment>
      )}
    </SlateElement>
  );
}
