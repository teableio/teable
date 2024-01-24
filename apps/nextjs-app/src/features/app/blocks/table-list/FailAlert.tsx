import { Frown } from '@teable-group/icons';
import { Alert, AlertDescription, AlertTitle } from '@teable-group/ui-lib/shadcn/ui/alert';

export const FailAlert: React.FC = () => {
  return (
    <Alert className="w-[400px]">
      <Frown className="size-5" />
      <AlertTitle>Crash!</AlertTitle>
      <AlertDescription>
        This view is broken. If the refresh still fails, run the data repair program.
      </AlertDescription>
    </Alert>
  );
};
