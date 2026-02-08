import type { ICustomHttpExceptionData, IHttpError } from '@teable/core';
import { getLocalizationMessage } from '@teable/sdk';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { ForbiddenPage } from './ForbiddenPage';
import { PaymentRequiredPage } from './PaymentRequired';

type HttpErrorPageProps = {
  httpError: IHttpError;
};

const errorComponentMap: Record<
  IHttpError['status'],
  React.ComponentType<{ description?: string }>
> = {
  402: PaymentRequiredPage,
  403: ForbiddenPage,
};

export const HttpErrorPage: FC<HttpErrorPageProps> = ({ httpError }) => {
  const { t } = useTranslation('common');

  const ErrorComponent = errorComponentMap[httpError.status];

  const { data } = httpError;
  const { localization } = (data as ICustomHttpExceptionData) || {};
  const description = localization
    ? getLocalizationMessage(localization, t as unknown as ILocaleFunction, 'sdk')
    : undefined;

  if (!ErrorComponent) {
    return null;
  }

  return <ErrorComponent description={description} />;
};
