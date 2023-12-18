import { TeableNew } from '@teable-group/icons';

export const SideBarHeader: React.FC = () => {
  return (
    <div className="m-2 flex items-center gap-1">
      <TeableNew className="h-6 w-6 shrink-0 text-black" />
      <p className="truncate text-sm">Teable</p>
      <div className="grow basis-0"></div>
    </div>
  );
};
