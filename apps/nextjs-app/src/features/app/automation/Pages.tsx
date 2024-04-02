import { Alert, AlertTitle, AlertDescription } from '@teable/ui-lib/shadcn/ui/alert';
export function AutomationPage() {
  return (
    <div className="h-full flex-col md:flex">
      <div className="flex flex-col gap-2 lg:gap-4">
        <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
          <h2 className="text-3xl font-bold tracking-tight">Automation</h2>
        </div>
      </div>
      <div className="flex h-full items-center justify-center p-4">
        <Alert className="w-[400px]">
          <AlertTitle>
            <span className="text-lg">🏗️</span> Coming soon
          </AlertTitle>
          <AlertDescription>Automation is under development</AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
