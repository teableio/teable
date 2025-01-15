import { cn, withRef } from '@udecode/cn';
import { getHandler } from '@udecode/plate-common';
import { PlateElement, useElement } from '@udecode/plate-common/react';
import type { TMentionElement } from '@udecode/plate-mention';
import React from 'react';
import { useFocused, useSelected } from 'slate-react';

export const MentionElement = withRef<
  typeof PlateElement,
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onClick?: (mentionNode: any) => void;
    prefix?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render?: (mentionable: any) => React.ReactNode;
  }
>(({ prefix, className, onClick, render, children, ...props }, ref) => {
  const element = useElement<TMentionElement>();
  const selected = useSelected();
  const focused = useFocused();

  return (
    <PlateElement
      className={cn(
        'inline-flex cursor-pointer rounded-md bg-slate-100 px-1.5 py-0 mx-0.5 align-baseline text-sm font-medium dark:bg-slate-800',
        selected && focused && 'ring-2 ring-slate-950 dark:ring-slate-300',
        element.children[0].bold === true && 'font-bold',
        element.children[0].italic === true && 'italic',
        element.children[0].underline === true && 'underline',
        className
      )}
      contentEditable={false}
      data-slate-value={element.value}
      onClick={getHandler(onClick, element)}
      ref={ref}
      {...props}
    >
      {prefix}
      {render ? render(element) : element.value}
      {children}
    </PlateElement>
  );
});
