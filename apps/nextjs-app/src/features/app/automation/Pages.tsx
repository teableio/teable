import { PackageCheck } from '@teable-group/icons';
export function AutomationPage() {
  return (
    <div className="h-full flex-col md:flex">
      <div className="flex flex-col gap-2 lg:gap-4">
        <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
          <h2 className="text-3xl font-bold tracking-tight">Automation</h2>
        </div>
      </div>
      <div className="flex grow items-center justify-center gap-4">
        <PackageCheck className="size-10" /> <h1>Coming Soon</h1>
      </div>
    </div>
  );
}
