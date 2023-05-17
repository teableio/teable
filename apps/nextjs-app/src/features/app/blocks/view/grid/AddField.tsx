import { useFieldSettingStore } from '@/features/app/components/field-setting/store';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { useGridTheme } from './useGridTheme';

export const AddField = ({ disabled, onClick }: { disabled?: boolean; onClick?: () => void }) => {
  const { open } = useFieldSettingStore();
  const theme = useGridTheme();

  const onClickBtn = () => {
    onClick?.();
    open({
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
        className="bg-base-100 min-w-[120px] w-full h-9 hover:bg-base-200 font-semibold text-lg border-b border-b-base-300"
        onClick={onClickBtn}
        disabled={disabled}
      >
        +
      </button>
    </div>
  );
};
