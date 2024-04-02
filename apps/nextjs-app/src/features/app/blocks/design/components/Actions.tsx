import { DotsHorizontalIcon } from '@radix-ui/react-icons';
import { useTable } from '@teable/sdk/hooks';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  Button,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { FieldOperator } from '@/features/app/components/field-setting';
import { useFieldSettingStore } from '../../view/field/useFieldSettingStore';

export const Actions = ({ fieldId }: { fieldId: string }) => {
  const { openSetting } = useFieldSettingStore();
  const table = useTable();
  const { t } = useTranslation(['common']);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="size-8 p-0">
          <DotsHorizontalIcon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => openSetting({ fieldId, operator: FieldOperator.Edit })}>
          {t('actions.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => {
            table?.deleteField(fieldId);
          }}
        >
          {t('actions.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
