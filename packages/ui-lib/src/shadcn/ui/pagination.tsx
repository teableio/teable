import { ChevronLeft, ChevronRight, MoreHorizontal } from '@teable/icons';
import * as React from 'react';

import { cn } from '../utils';
import type { ButtonProps } from './button';
import { buttonVariants } from './button';

const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn('flex w-full justify-center', className)}
    {...props}
  />
);
Pagination.displayName = 'Pagination';

const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-row items-center gap-1', className)} {...props} />
  )
);
PaginationContent.displayName = 'PaginationContent';

const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({ className, ...props }, ref) => <li ref={ref} className={className} {...props} />
);
PaginationItem.displayName = 'PaginationItem';

// App pagination is client-side, so the trigger is a real <button> (not an <a href>) for
// correct semantics and keyboard handling, while keeping the shadcn link styling.
type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<ButtonProps, 'size'> &
  React.ComponentProps<'button'>;

const PaginationLink = ({
  className,
  isActive,
  size = 'icon-sm',
  type = 'button',
  ...props
}: PaginationLinkProps) => (
  // eslint-disable-next-line react/button-has-type
  <button
    type={type}
    aria-current={isActive ? 'page' : undefined}
    className={cn(
      buttonVariants({ variant: isActive ? 'outline' : 'ghost', size }),
      'disabled:pointer-events-none disabled:opacity-50',
      className
    )}
    {...props}
  />
);
PaginationLink.displayName = 'PaginationLink';

const PaginationPrevious = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink size="sm" className={cn('gap-1 px-2.5', className)} {...props}>
    <ChevronLeft className="size-4 shrink-0" />
    {children}
  </PaginationLink>
);
PaginationPrevious.displayName = 'PaginationPrevious';

const PaginationNext = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink size="sm" className={cn('gap-1 px-2.5', className)} {...props}>
    {children}
    <ChevronRight className="size-4 shrink-0" />
  </PaginationLink>
);
PaginationNext.displayName = 'PaginationNext';

const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span
    aria-hidden
    className={cn('flex size-8 items-center justify-center text-muted-foreground', className)}
    {...props}
  >
    <MoreHorizontal className="size-4" />
  </span>
);
PaginationEllipsis.displayName = 'PaginationEllipsis';

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
