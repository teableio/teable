import type { IIntegrationConfig } from '@teable/openapi';
import { Card, CardHeader, CardTitle, CardContent, Switch } from '@teable/ui-lib/shadcn';

interface IIntegrationCardProps {
  title: React.ReactNode;
  enable?: boolean;
  config: IIntegrationConfig;
  children?: React.ReactNode;
  onCheckedChange?: (checked: boolean) => void;
}

export const IntegrationCard = (props: IIntegrationCardProps) => {
  const { title, enable, children, onCheckedChange } = props;

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-center justify-between border-b p-4">
        <CardTitle className="text-lg">{title}</CardTitle>
        <Switch checked={enable} onCheckedChange={onCheckedChange} />
      </CardHeader>
      <CardContent className="max-h-[360px] overflow-y-auto overflow-x-hidden p-4">
        {children}
      </CardContent>
    </Card>
  );
};
