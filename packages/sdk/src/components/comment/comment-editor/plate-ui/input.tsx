import { withVariants } from '@udecode/cn';
import { cva } from 'class-variance-authority';

export const inputVariants = cva(
  'flex w-full rounded-md bg-transparent text-sm file:border-0 file:bg-white file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:file:bg-slate-950 dark:placeholder:text-slate-400',
  {
    defaultVariants: {
      h: 'md',
      variant: 'default',
    },
    variants: {
      h: {
        md: 'h-10 px-3 py-2',
        sm: 'h-9 px-3 py-2',
      },
      variant: {
        default:
          'border border-slate-200 ring-offset-white focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 dark:border-slate-800 dark:ring-offset-slate-950 dark:focus-visible:ring-slate-300',
        ghost: 'border-none focus-visible:ring-transparent',
      },
    },
  }
);

export const Input = withVariants('input', inputVariants, ['variant', 'h']);
