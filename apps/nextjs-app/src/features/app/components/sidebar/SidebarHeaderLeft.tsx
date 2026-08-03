import { ChevronsLeft } from '@teable/icons';
import { TeableLogo } from '@/components/TeableLogo';
import { useBrand } from '../../hooks/useBrand';

interface ISidebarBackButtonProps {
  title?: string;
  icon?: React.ReactNode;
  onBack?: () => void;
}

export const SidebarHeaderLeft = (props: ISidebarBackButtonProps) => {
  const { title, icon, onBack } = props;
  const displayIcon = icon ?? <TeableLogo className="size-5 shrink-0" />;
  const { brandName } = useBrand();

  return (
    <>
      {onBack ? (
        <div
          className="group relative size-5 shrink-0 cursor-pointer"
          onClick={() => onBack?.()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              onBack?.();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div className="absolute top-0 size-5 group-hover:opacity-0">{displayIcon}</div>
          <ChevronsLeft className="absolute top-0 size-5 opacity-0 group-hover:opacity-100" />
        </div>
      ) : (
        displayIcon
      )}

      <p className="ml-[2px] truncate text-sm">{title ?? brandName}</p>
    </>
  );
};
