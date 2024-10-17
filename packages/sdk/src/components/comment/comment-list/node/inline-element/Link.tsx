import { cn } from '@teable/ui-lib';
import type { IBaseNodeProps } from '../type';

interface InlineLinkElementProps extends IBaseNodeProps {
  href: string;
  title?: string;
}

export const InlineLinkElement = (props: InlineLinkElementProps) => {
  const { href, title, className } = props;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn('cursor-pointer text-wrap break-all text-blue-500 underline', className)}
    >
      {title}
    </a>
  );
};
