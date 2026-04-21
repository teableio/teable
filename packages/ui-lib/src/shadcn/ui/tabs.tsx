'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '../utils';

type TabsSize = 'default' | 'sm';

const TabsSizeContext = React.createContext<TabsSize>('default');

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & { size?: TabsSize }
>(({ size = 'default', ...props }, ref) => (
  <TabsSizeContext.Provider value={size}>
    <TabsPrimitive.Root ref={ref} {...props} />
  </TabsSizeContext.Provider>
));
Tabs.displayName = TabsPrimitive.Root.displayName;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const size = React.useContext(TabsSizeContext);
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-lg p-1 bg-primary/5 dark:border dark:border-white/15 text-muted-foreground',
        size === 'sm' ? 'h-8' : 'h-9',
        className
      )}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const size = React.useContext(TabsSizeContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap h-full rounded-md font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-popover data-[state=active]:text-foreground data-[state=active]:shadow',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-3 text-sm',
        className
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
