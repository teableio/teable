import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IInviteWaitlistRo } from '@teable/openapi';
import { inviteWaitlist, getWaitlist } from '@teable/openapi';
import {
  Input,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Button,
  TableHead,
  TableHeader,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { keyBy } from 'lodash';
import { SettingsIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';

interface TableRow {
  email: string;
  invite: string;
  inviteTime: string;
  createdTime: string;
}

interface IWaitlistTableProps {
  list: TableRow[];
  onSelect: (selected: string[]) => void;
}

const WaitlistTable = (props: IWaitlistTableProps) => {
  const { t } = useTranslation('common');
  const { list, onSelect } = props;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filteredList = useMemo(() => {
    return list.filter((item) => item.email.toLowerCase().includes(search.toLowerCase()));
  }, [list, search]);

  const handleSelect = (email: string) => {
    setSelected((prev) => {
      if (prev.has(email)) {
        prev.delete(email);
      } else {
        prev.add(email);
      }
      return new Set(prev);
    });
    onSelect(Array.from(selected));
  };

  const handleSelectAll = () => {
    setSelected((prev) => {
      if (prev.size === filteredList.length) {
        return new Set();
      }
      return new Set(filteredList.map((item) => item.email));
    });
    onSelect(Array.from(selected));
  };

  return (
    <div className="w-full ">
      <div className="flex items-center">
        <Input
          placeholder={t('actions.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="mt-4 max-h-[400px] overflow-y-auto overflow-x-hidden rounded-md border ">
        <Table className="relative scroll-smooth">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="h-8 text-sm font-semibold ">
              <TableCell className="text-center">
                <Checkbox
                  checked={
                    (selected.size === filteredList.length && selected.size > 0) ||
                    (selected.size > 0 && 'indeterminate')
                  }
                  onCheckedChange={() => handleSelectAll()}
                />
              </TableCell>
              <TableHead className="text-center">{t('waitlist.email')}</TableHead>
              <TableHead className="text-center">{t('waitlist.invite')}</TableHead>
              <TableHead className="text-center">{t('waitlist.inviteTime')}</TableHead>
              <TableHead className="text-center">{t('waitlist.createdTime')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredList.map((item) => {
              const { email, invite, inviteTime, createdTime } = item;
              return (
                <TableRow
                  key={email}
                  className="h-8 cursor-pointer"
                  onClick={() => handleSelect(email)}
                >
                  <TableCell className="text-center">
                    <Checkbox checked={selected.has(email)} />
                  </TableCell>
                  <TableCell className="text-center">{email}</TableCell>
                  <TableCell className="text-center">{invite}</TableCell>
                  <TableCell className="text-center">{inviteTime}</TableCell>
                  <TableCell className="text-center">{createdTime}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export const WaitlistManage = () => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { data: list = [] } = useQuery({
    queryKey: ['waitlist'],
    queryFn: () => getWaitlist().then(({ data }) => data),
  });
  const inviteMap = keyBy(list, 'email');
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const { mutateAsync: inviteWaitlistMutation } = useMutation({
    mutationFn: (ro: IInviteWaitlistRo) => inviteWaitlist(ro),
    onSuccess: ({ data }) => {
      if (data.length > 0) {
        toast.success(t('waitlist.inviteSuccess'));
      }
      queryClient.invalidateQueries({ queryKey: ['waitlist'] });
    },
  });

  const canInvite = useMemo(() => {
    return selectedEmails.some((email) => !inviteMap[email]?.invite);
  }, [selectedEmails, inviteMap]);

  const handleInvite = async () => {
    await inviteWaitlistMutation({
      list: selectedEmails,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          <SettingsIcon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className=" max-w-3xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('waitlist.title')}</DialogTitle>
        </DialogHeader>
        <WaitlistTable
          list={list.map((item) => ({
            email: item.email,
            invite: item.invite ? t('waitlist.yes') : t('waitlist.no'),
            inviteTime: item.inviteTime ? dayjs(item.inviteTime).format('YYYY-MM-DD ') : '',
            createdTime: item.createdTime ? dayjs(item.createdTime).format('YYYY-MM-DD') : '',
          }))}
          onSelect={setSelectedEmails}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('actions.close')}
          </Button>
          <Button onClick={handleInvite} disabled={!canInvite}>
            {t('waitlist.invite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
