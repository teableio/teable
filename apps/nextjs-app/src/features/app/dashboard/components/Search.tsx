import { Input } from '@teable/ui-lib/shadcn';

export function Search() {
  return (
    <div>
      <Input type="search" placeholder="Search..." className="md:w-[100px] lg:w-[300px]" />
    </div>
  );
}
