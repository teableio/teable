import { cn } from '@teable/ui-lib';
import type { IBaseNodeProps } from '../type';

interface IBlockParagraphElementProps extends IBaseNodeProps {
  children: React.ReactNode;
}

export const BlockParagraphElement = (props: IBlockParagraphElementProps) => {
  const { children, className } = props;
  return (
    <div className={cn('max-w-full whitespace-pre-wrap break-all', className)}>{children}</div>
  );
};
