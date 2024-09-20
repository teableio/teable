import { cn, withRef } from '@udecode/cn';
import { PlateElement, useElement } from '@udecode/plate-common/react';
import type { TLinkElement } from '@udecode/plate-link';
import { useLink } from '@udecode/plate-link/react';
import React from 'react';

export const LinkElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<TLinkElement>();
    const { props: linkProps } = useLink({ element });

    return (
      <PlateElement
        asChild
        className={cn(
          'font-medium text-slate-900 underline decoration-primary underline-offset-4 dark:text-slate-50',
          className
        )}
        ref={ref}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...(linkProps as any)}
        {...props}
      >
        <a href={linkProps.href}>{children}</a>
      </PlateElement>
    );
  }
);
