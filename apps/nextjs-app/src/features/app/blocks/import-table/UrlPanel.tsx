import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import type { FieldType } from '@teable/core';
import type { SUPPORTEDTYPE } from '@teable/openapi';
import { importTypeMap } from '@teable/openapi';
import { Input, Button, Spin } from '@teable/ui-lib';
import type { AxiosResponse } from 'axios';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { z } from 'zod';

interface IUrlPanel {
  fileType: SUPPORTEDTYPE;
  analyzeFn: UseMutateAsyncFunction<
    AxiosResponse<
      {
        worksheets: Record<
          string,
          {
            name: string;
            columns: {
              name: string;
              type: FieldType;
            }[];
          }
        >;
      },
      unknown
    >,
    unknown,
    {
      fileType: SUPPORTEDTYPE;
      attachmentUrl: string;
    },
    unknown
  >;
  isFinished: boolean;
}

const UrlPanel = (props: IUrlPanel) => {
  const { fileType, analyzeFn, isFinished } = props;
  const [linkUrl, setLinkUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const { t } = useTranslation(['table']);

  return (
    <div className="flex h-32 w-full flex-col items-start px-2">
      <h4 className="m-2 text-sm">{t('table:import.title.linkUrlInputTitle')}</h4>
      <div className="flex w-full">
        <Input
          type="url"
          placeholder={importTypeMap[fileType].exampleUrl}
          className="mr-2 w-full"
          value={linkUrl}
          onChange={(e) => {
            const { value } = e.target;
            setLinkUrl(value);
          }}
        />
        <Button
          variant="outline"
          disabled={isFinished || !linkUrl}
          onClick={() => {
            if (!linkUrl) {
              setErrorMessage(t('table:import.form.error.urlEmptyTip'));
              return;
            }
            if (!z.string().url().safeParse(linkUrl).success) {
              setErrorMessage(t('table:import.form.error.urlValidateTip'));
              return;
            }
            analyzeFn({
              attachmentUrl: linkUrl,
              fileType,
            });
          }}
        >
          {isFinished && <Spin className="mr-1 size-4" />}
          {t('table:import.title.upload')}
        </Button>
      </div>
      {errorMessage && <p className="p-2 text-sm text-red-500">{errorMessage}</p>}
    </div>
  );
};

export { UrlPanel };
