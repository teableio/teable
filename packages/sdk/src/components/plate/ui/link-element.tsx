'use client';

import type { PlateElementProps } from '@udecode/plate/react';
import { PlateElement } from '@udecode/plate/react';
import type { TLinkElement } from '@udecode/plate-link';

import { useLink } from '@udecode/plate-link/react';
import * as React from 'react';

export function LinkElement(props: PlateElementProps<TLinkElement>) {
  const { props: linkProps } = useLink({ element: props.element });

  return (
    <PlateElement
      {...props}
      as="a"
      className="font-medium text-primary underline decoration-primary underline-offset-4"
      attributes={{
        ...props.attributes,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(linkProps as any),
      }}
    >
      {props.children}
    </PlateElement>
  );
}
