import { ArrowLeft } from '@teable/icons';
import { Button, Label, Separator } from '@teable/ui-lib';
import { useRouter } from 'next/router';
import React, { type FC } from 'react';

export const BillingPage: FC = () => {
  const router = useRouter();
  const { spaceId } = router.query as { spaceId: string };

  const backSpace = () => {
    router.push({
      pathname: '/space/[spaceId]',
      query: { spaceId },
    });
  };

  return (
    <div>
      <div>
        <Button size="sm" type="button" variant="ghost" onClick={backSpace}>
          <ArrowLeft />
          Go to Space
        </Button>
      </div>
      <Separator className="my-2" />
      <div className="ml-4 space-y-2 pt-3">
        <Label className="text-sm">Billing summary</Label>
      </div>
      <Separator className="my-2" />
      <div className="ml-4 space-y-2 pt-3">
        <Label className="text-sm">Current plan</Label>
      </div>
      <Separator className="my-2" />
    </div>
  );
};
