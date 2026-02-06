import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { IllustrationPage } from './IllustrationPage';

type Props = {
  statusCode?: number | null;
  error?: Error;
  message?: string;
  errorId?: string;
  children?: never;
};

export const ErrorPage: FC<Props> = (props) => {
  const { error, errorId, message, statusCode } = props;
  const { t } = useTranslation('common');

  return (
    <div className="relative">
      <IllustrationPage
        imageLightSrc="/images/layout/error-light.png"
        imageDarkSrc="/images/layout/error-dark.png"
        imageAlt="Error"
        title={t('system.error.title')}
        description={t('system.error.description')}
        button={{ label: t('system.links.backToHome'), href: '/' }}
      />
      <div className="absolute bottom-0 right-0 m-5 flex flex-col gap-1 rounded-lg border bg-background p-4 text-left text-sm">
        <div className="flex gap-2" data-testid="error-status-code">
          <span className="text-muted-foreground">Code: </span>
          <span className="text-foreground">{statusCode}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">Message: </span>
          <span className="text-foreground">{message}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">Error id: </span>
          <span className="text-foreground">{errorId}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">ErrorMessage: </span>
          <span className="text-foreground">{error?.message}</span>
        </div>
      </div>
    </div>
  );
};
