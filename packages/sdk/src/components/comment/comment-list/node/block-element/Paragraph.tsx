import { cn } from '@teable/ui-lib';
import { useContentDir } from '../../../../../hooks/use-content-dir';
import type { IBaseNodeProps } from '../type';

interface IBlockParagraphElementProps extends IBaseNodeProps {
  children: React.ReactNode;
}

export const BlockParagraphElement = (props: IBlockParagraphElementProps) => {
  const { children, className } = props;
  const contentDir = useContentDir();
  return (
    <div dir={contentDir} className={cn('max-w-full whitespace-pre-wrap break-all', className)}>
      {children}
    </div>
  );
};
