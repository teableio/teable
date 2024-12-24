import { X } from '@teable/icons';
import { Button, ScrollArea } from '@teable/ui-lib';
import { useTranslation } from '../../context/app/i18n';
import { DepartmentItem } from './components/DepartmentItem';
import { UserItem } from './components/UserItem';
import { TreeNodeType, type SelectedMemberWithData } from './types';

interface SelectedMembersProps {
  selectedMembers: SelectedMemberWithData[];
  onRemove: (id: string) => void;
}

export function MemberSelected({ selectedMembers, onRemove }: SelectedMembersProps) {
  const { t } = useTranslation();
  if (selectedMembers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('memberSelector.empty')}
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 p-4">
        {selectedMembers.map(({ id, data }) => {
          const suffix = (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 h-auto text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(id)}
            >
              <X className="size-4" />
              <span className="sr-only">
                {t('common.remove')} {data.name}
              </span>
            </Button>
          );
          return data.type === TreeNodeType.DEPARTMENT ? (
            <DepartmentItem
              key={id}
              name={data.name}
              checked={false}
              suffix={suffix}
              showCheckbox={false}
            />
          ) : (
            <UserItem
              key={id}
              name={data.name}
              email={data.email}
              avatar={data.avatar}
              suffix={suffix}
              showCheckbox={false}
            />
          );
        })}
      </div>
    </ScrollArea>
  );
}
