import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from '@teable/icons';
import { getWebhookList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { Button, Separator } from '@teable/ui-lib';
import { useRouter } from 'next/router';
import React, { type FC, Fragment } from 'react';
import { DataTable } from './data-table/DataTable';
import { useDataColumns } from './data-table/useDataColumns';
import type { IFormType } from './form/HookForm';
import { HookForm } from './form/HookForm';

export const HooksPage: FC = () => {
  const router = useRouter();
  const { spaceId, form: formType } = router.query as { spaceId: string; form: IFormType };

  const backSpace = () => {
    router.push({
      pathname: '/space/[spaceId]',
      query: { spaceId },
    });
  };

  return (
    <Fragment>
      <div>
        <Button size="sm" type="button" variant="ghost" onClick={backSpace}>
          <ArrowLeft />
          Go to Space
        </Button>
      </div>
      <Separator className="my-2" />
      <div className="pr-2">{formType ? <HookForm /> : <DataTable />}</div>
    </Fragment>
  );
};
