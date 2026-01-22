import { ArrowLeft, HelpCircle } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib/shadcn';
import Head from 'next/head';

interface ISettingRightTitle {
  title?: React.ReactNode;
  onBack?: () => void;
  description?: React.ReactNode;
  helpLink?: string;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  withHead?: boolean;
}
export const SettingRightTitle = (props: ISettingRightTitle) => {
  const {
    title,
    onBack,
    description,
    helpLink,
    className,
    titleClassName,
    descriptionClassName,
    withHead = true,
  } = props;
  return (
    <div className={cn('flex flex-1 items-start gap-2', className)}>
      {onBack && (
        <Button className="px-0 text-base" variant={'link'} onClick={onBack}>
          <ArrowLeft />
        </Button>
      )}
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          {withHead && typeof title === 'string' && (
            <Head>
              <title>{title}</title>
            </Head>
          )}
          <h2 className={cn('flex-1 text-base', titleClassName)}>{title}</h2>
          {helpLink && (
            <Button variant="ghost" size="xs" asChild>
              <a href={helpLink} target="_blank" rel="noreferrer">
                <HelpCircle className="size-4" />
              </a>
            </Button>
          )}
        </div>
        {description && (
          <div className={cn('text-sm text-muted-foreground', descriptionClassName)}>
            {description}
          </div>
        )}
      </div>
    </div>
  );
};
