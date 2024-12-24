import { Button, cn, DialogFooter, DialogHeader, DialogTitle, Separator } from '@teable/ui-lib';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { DepartmentList } from './DepartmentList';
import { MemberSelected } from './MemberSelected';
import { SearchInput } from './SearchInput';
import type { SelectedMemberWithData, TreeNode } from './types';

interface IMemberContentProps {
  className?: string;
  departmentId?: string;
  defaultSelectedMembers?: SelectedMemberWithData[];
  onCancel?: () => void;
  onConfirm?: (selectedMembers: SelectedMemberWithData[]) => void;
}

export interface IMemberContentRef {
  open: (selectedMembers?: SelectedMemberWithData[]) => void;
}

const _defaultSelectedMembers: SelectedMemberWithData[] = [];

export const MemberContent = forwardRef<IMemberContentRef, IMemberContentProps>(
  (
    { className, departmentId, defaultSelectedMembers, onCancel, onConfirm }: IMemberContentProps,
    ref
  ) => {
    const [search, setSearch] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<SelectedMemberWithData[]>(
      defaultSelectedMembers ?? _defaultSelectedMembers
    );
    const { t } = useTranslation();

    useImperativeHandle(ref, () => ({
      open: (selectedMembers) => {
        setSelectedMembers(selectedMembers ?? []);
      },
    }));

    const handleSelect = (member: TreeNode) => {
      setSelectedMembers((prev) => {
        const exists = prev.some((m) => m.id === member.id);
        if (exists) {
          return prev.filter((m) => m.id !== member.id);
        }
        return [...prev, { id: member.id, type: member.type, data: member }];
      });
    };

    const handleRemove = (id: string) => {
      setSelectedMembers((prev) => prev.filter((member) => member.id !== id));
    };

    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <DialogHeader>
          <DialogTitle>{t('memberSelector.title')}</DialogTitle>
        </DialogHeader>
        <div className="mb-2">
          <SearchInput
            search={search}
            onSearch={setSearch}
            placeholder={t('memberSelector.memberSelectorSearchPlaceholder')}
          />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
          <div className="flex min-h-0 flex-col">
            <div className="h-8"></div>
            <div className="min-h-0 flex-1 rounded-lg border">
              <DepartmentList
                departmentId={departmentId}
                selectedMembers={selectedMembers}
                onSelect={handleSelect}
                className="h-full"
                search={search}
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="h-8 px-2 text-sm font-medium text-muted-foreground">
              {t('memberSelector.selected')} ({selectedMembers.length})
            </div>
            <div className="min-h-0 flex-1 rounded-lg border">
              <MemberSelected selectedMembers={selectedMembers} onRemove={handleRemove} />
            </div>
          </div>
        </div>
        <Separator className="my-4" />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm?.(selectedMembers)}>{t('common.confirm')}</Button>
        </DialogFooter>
      </div>
    );
  }
);

MemberContent.displayName = 'MemberContent';
