import { Input } from '@teable-group/ui-lib/shadcn';

export function Search() {
  return (
    <div>
      <Input type="search" placeholder="Search..." className="md:w-[100px] lg:w-[300px]" />
    </div>
  );
}
