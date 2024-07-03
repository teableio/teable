import { ArrowLeft, ChevronDown } from '@teable/icons';
import {
  Button,
  Input,
  Label,
  Progress,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@teable/ui-lib';
import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { type FC } from 'react';

export const UsagePage: FC = () => {
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
        <Label className="text-sm">Usage this month</Label>
        <div className="bg-gray-800 p-6 text-white">
          <h2 className="text-2xl font-semibold">Actions</h2>
          <div className="mt-4 rounded-lg bg-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ChevronDown className="size-5 text-blue-400" />
                <span className="text-sm">
                  Included minutes quota resets in 3 days.{' '}
                  <Link className="text-blue-400" href="#">
                    See billing documentation
                  </Link>
                </span>
              </div>
              <Button className="bg-blue-500 text-white hover:bg-blue-600" variant="ghost">
                Get usage report
              </Button>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <ChevronDown className="size-5" />
                  <h3 className="text-lg font-medium">Usage minutes</h3>
                </div>
                <span className="text-sm">0.00 of 2,000.00 min included</span>
              </div>
              <div className="mt-2">
                <Progress className="w-full" value={10} />
              </div>
              <div className="mt-2 text-xs text-gray-400">
                Included minutes quota only applies to Ubuntu 2-core, Windows 2-core and macOS
                3-core runners. Windows 2-core and macOS 3-core runners consume included minutes at
                higher rates.
                <Link className="text-blue-400" href="#">
                  Learn more.
                </Link>
              </div>
            </div>
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left">Included</TableHead>
                    <TableHead className="text-left">Paid</TableHead>
                    <TableHead className="text-left">Price / minute</TableHead>
                    <TableHead className="text-left">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Ubuntu 2-core</TableCell>
                    <TableCell>0.00</TableCell>
                    <TableCell>$0.008</TableCell>
                    <TableCell>$0.00</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Windows 2-core</TableCell>
                    <TableCell>0.00</TableCell>
                    <TableCell>$0.016</TableCell>
                    <TableCell>$0.00</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>macOS 3-core</TableCell>
                    <TableCell>0.00</TableCell>
                    <TableCell>$0.08</TableCell>
                    <TableCell>$0.00</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm">
                $0.00 monthly spending limit |
                <Link className="text-blue-400" href="#">
                  Set up a spending limit
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
