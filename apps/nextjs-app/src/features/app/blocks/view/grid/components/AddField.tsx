import { FieldOperator } from '@/features/app/components/field-setting/type';
import { useGridTheme } from '../hooks';
import { useGridViewStore } from '../store/gridView';

export const AddField = ({ disabled, onClick }: { disabled?: boolean; onClick?: () => void }) => {
  const { openSetting } = useGridViewStore();
  const theme = useGridTheme();

  const onClickBtn = () => {
    onClick?.();
    openSetting({
      operator: FieldOperator.Add,
    });
  };
  return (
    <div
      className="h-full"
      style={{
        backgroundColor: theme.bgHeader,
      }}
    >
      <button
        className="bg-background min-w-[120px] w-full h-9 hover:bg-accent font-semibold text-lg border-b"
        onClick={onClickBtn}
        disabled={disabled}
      >
        +
      </button>
    </div>
  );
};
