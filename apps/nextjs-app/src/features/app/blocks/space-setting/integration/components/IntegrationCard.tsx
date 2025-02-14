import { MoreHorizontal, Trash2 } from '@teable/icons';
import type { IIntegrationConfig } from '@teable/openapi';
import {
  Switch,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

interface IIntegrationCardProps {
  title: React.ReactNode;
  enable?: boolean;
  config: IIntegrationConfig;
  children?: React.ReactNode;
  onCheckedChange?: (checked: boolean) => void;
  onDelete?: () => void;
}

export const IntegrationCard = (props: IIntegrationCardProps) => {
  const { title, enable, children, onCheckedChange, onDelete } = props;

  const { t } = useTranslation('common');

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-center justify-between border-b p-4">
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="flex items-center space-x-1">
          <Switch checked={enable} onCheckedChange={onCheckedChange} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="my-[2px] w-full justify-start text-sm font-normal"
              >
                <MoreHorizontal className="size-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-[200px]">
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 size-4 shrink-0" />
                <p className="truncate">{t('actions.delete')}</p>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="max-h-[360px] overflow-y-auto overflow-x-hidden p-4">
        {children}
      </CardContent>
    </Card>
  );
};
