import { cn } from '@teable/ui-lib';
import type { IBaseNodeProps } from '../type';

interface IBlockParagraphElementProps extends IBaseNodeProps {
  children: React.ReactNode;
}

export const BlockParagraphElement = (props: IBlockParagraphElementProps) => {
  const { children, className } = props;
  return (
    <div className={cn('text-wrap w-auto flex', className)}>
      <span className="gap-1 text-wrap text-left">{children}</span>
    </div>
  );
};
