/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import type { ItemInstance } from '@headless-tree/core';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';
import { cn } from '../utils';

interface TreeContextValue<T = any> {
  indent: number;
  currentItem?: ItemInstance<T>;
  tree?: any;
}

const TreeContext = React.createContext<TreeContextValue>({
  indent: 20,
  currentItem: undefined,
  tree: undefined,
});

function useTreeContext<T = any>() {
  return React.useContext(TreeContext) as TreeContextValue<T>;
}

interface TreeProps extends React.HTMLAttributes<HTMLDivElement> {
  indent?: number;
  tree?: any;
}

function Tree({ indent = 20, tree, className, ...props }: TreeProps) {
  const containerProps =
    tree && typeof tree.getContainerProps === 'function' ? tree.getContainerProps() : {};
  const mergedProps = { ...props, ...containerProps };

  // Extract style from mergedProps to merge with our custom styles
  const { style: propStyle, ...otherProps } = mergedProps;

  // Merge styles
  const mergedStyle = {
    ...propStyle,
    '--tree-indent': `${indent}px`,
  } as React.CSSProperties;

  return (
    <TreeContext.Provider value={{ indent, tree }}>
      <div
        data-slot="tree"
        style={mergedStyle}
        className={cn('flex flex-col isolate', className)}
        {...otherProps}
      />
    </TreeContext.Provider>
  );
}

interface TreeItemProps<T = any> extends React.HTMLAttributes<HTMLButtonElement> {
  item: ItemInstance<T>;
  indent?: number;
  asChild?: boolean;
}

function TreeItem<T = any>({
  item,
  className,
  asChild,
  children,
  ...props
}: Omit<TreeItemProps<T>, 'indent'>) {
  const { indent } = useTreeContext<T>();

  const itemProps = typeof item.getProps === 'function' ? item.getProps() : {};
  const mergedProps = { ...props, ...itemProps };

  // Extract style from mergedProps to merge with our custom styles
  const { style: propStyle, ...otherProps } = mergedProps;

  // Merge styles
  const mergedStyle = {
    ...propStyle,
    '--tree-padding': `${item.getItemMeta().level * indent}px`,
  } as React.CSSProperties;

  const Comp = asChild ? Slot : 'button';

  return (
    <TreeContext.Provider value={{ indent, currentItem: item }}>
      <Comp
        data-slot="tree-item"
        style={mergedStyle}
        className={cn(
          'group ps-[var(--tree-padding)] outline-none select-none pb-0.5 last:pb-0 focus:z-20 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          className
        )}
        data-focus={typeof item.isFocused === 'function' ? item.isFocused() || false : undefined}
        data-folder={typeof item.isFolder === 'function' ? item.isFolder() || false : undefined}
        data-selected={
          typeof item.isSelected === 'function' ? item.isSelected() || false : undefined
        }
        data-drag-target={
          typeof item.isDragTarget === 'function' ? item.isDragTarget() || false : undefined
        }
        data-search-match={
          typeof item.isMatchingSearch === 'function' ? item.isMatchingSearch() || false : undefined
        }
        aria-expanded={item.isExpanded()}
        {...otherProps}
      >
        {children}
      </Comp>
    </TreeContext.Provider>
  );
}

interface TreeItemLabelProps<T = any> extends React.HTMLAttributes<HTMLSpanElement> {
  item?: ItemInstance<T>;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function TreeItemLabel<T = any>({
  item: propItem,
  children,
  className,
  ...props
}: TreeItemLabelProps<T>) {
  const { currentItem } = useTreeContext<T>();
  const item = propItem || currentItem;

  if (!item) {
    console.warn('TreeItemLabel: No item provided via props or context');
    return null;
  }

  const isFolder = typeof item.isFolder === 'function' ? item.isFolder() : false;
  const isSelected = typeof item.isSelected === 'function' ? item.isSelected() : false;
  const isDragTarget = typeof item.isDragTarget === 'function' ? item.isDragTarget() : false;
  const isSearchMatch =
    typeof item.isMatchingSearch === 'function' ? item.isMatchingSearch() : false;

  return (
    <span
      data-slot="tree-item-label"
      data-folder={isFolder ? 'true' : undefined}
      data-selected={isSelected ? 'true' : undefined}
      data-drag-target={isDragTarget ? 'true' : undefined}
      data-search-match={isSearchMatch ? 'true' : undefined}
      className={cn(
        'flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-sm transition-colors hover:bg-accent group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        isDragTarget && 'border-dashed border-foreground bg-foreground/[0.06]',
        isSearchMatch && 'bg-blue-400/20',
        isSelected && 'bg-accent text-accent-foreground',
        className
      )}
      {...props}
    >
      {children || (typeof item.getItemName === 'function' ? item.getItemName() : null)}
    </span>
  );
}

function TreeDragLine({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { tree } = useTreeContext();

  if (!tree || typeof tree.getDragLineStyle !== 'function') {
    console.warn(
      'TreeDragLine: No tree provided via context or tree does not have getDragLineStyle method'
    );
    return null;
  }

  const dragLine = tree.getDragLineStyle();
  return (
    <div
      style={dragLine}
      className={cn(
        'absolute z-30 -mt-px h-px w-[unset] bg-foreground before:absolute before:-left-[3px] before:-top-[2.5px] before:border-y-[3px] before:border-l-[3px] before:border-y-transparent before:border-l-foreground',
        className
      )}
      {...props}
    />
  );
}

export { Tree, TreeItem, TreeItemLabel, TreeDragLine };
