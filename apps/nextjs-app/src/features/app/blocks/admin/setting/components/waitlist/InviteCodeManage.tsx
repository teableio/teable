import { useMutation } from '@tanstack/react-query';
import type { IWaitlistInviteCodeVo } from '@teable/openapi';
import { genWaitlistInviteCode } from '@teable/openapi';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Button,
  TableHead,
  TableHeader,
  Input,
  Label,
} from '@teable/ui-lib/shadcn';
import { PencilIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

const CodeTable = (props: { list: IWaitlistInviteCodeVo }) => {
  const { t } = useTranslation('common');
  const { list } = props;
  return (
    <div className="w-full ">
      <div className="mt-4 max-h-[420px] overflow-y-auto overflow-x-hidden rounded-md border ">
        <Table className="relative scroll-smooth">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="h-8 text-sm font-semibold ">
              <TableHead className="text-center">{t('waitlist.code')}</TableHead>
              <TableHead className="text-center">{t('waitlist.times')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((item) => {
              const { code, times } = item;
              return (
                <TableRow key={code} className="h-8">
                  <TableCell className="text-center">{code}</TableCell>
                  <TableCell className="text-center">{times}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export const InviteCodeManage = () => {
  const { t } = useTranslation('common');
  const [count, setCount] = useState(10);
  const [times, setTimes] = useState(10);
  const [list, setList] = useState<IWaitlistInviteCodeVo>([]);
  const { mutateAsync: genWaitlistInviteCodeMutation } = useMutation({
    mutationFn: () => genWaitlistInviteCode({ count, times }),
    onSuccess: ({ data }) => {
      setList(data);
    },
  });
  const [open, setOpen] = useState(false);

  const cancel = () => {
    setList([]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" onClick={() => setOpen(true)}>
          <PencilIcon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('waitlist.generateCode')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Label>{t('waitlist.count')}</Label>
              <Input
                className="flex-1"
                type="number"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label>{t('waitlist.times')}</Label>
              <Input
                type="number"
                className="flex-1"
                value={times}
                onChange={(e) => setTimes(Number(e.target.value))}
              />
            </div>
          </div>
          {list.length > 0 && <CodeTable list={list} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={() => genWaitlistInviteCodeMutation()}>{t('waitlist.generate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
