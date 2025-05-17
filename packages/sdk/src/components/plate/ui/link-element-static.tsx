import type { SlateElementProps } from '@udecode/plate';
import { SlateElement } from '@udecode/plate';
import type { TLinkElement } from '@udecode/plate-link';

import * as React from 'react';

export function LinkElementStatic(props: SlateElementProps<TLinkElement>) {
  return (
    <SlateElement
      {...props}
      as="a"
      className="font-medium text-primary underline decoration-primary underline-offset-4"
    >
      {props.children}
    </SlateElement>
  );
}
