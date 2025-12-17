import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../utils';

const switchVariants = cva(
  'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input data-[state=unchecked]:dark:bg-white/15',
  {
    variants: {
      size: {
        default: 'h-5 w-9',
        sm: 'h-4 w-[26px]',
        lg: 'h-6 w-11',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const switchThumbVariants = cva(
  'pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform',
  {
    variants: {
      size: {
        default: 'h-4 w-4 data-[state=checked]:translate-x-4',
        sm: 'h-3 w-3 data-[state=checked]:translate-x-[10px]',
        lg: 'h-[18px] w-[18px] translate-x-[3px] data-[state=checked]:translate-x-[21px]',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    VariantProps<typeof switchVariants> {
  classNameThumb?: string;
}

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, classNameThumb, size, ...props }, ref) => (
    <SwitchPrimitives.Root className={cn(switchVariants({ size, className }))} {...props} ref={ref}>
      <SwitchPrimitives.Thumb
        className={cn(switchThumbVariants({ size, className: classNameThumb }))}
      />
    </SwitchPrimitives.Root>
  )
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
