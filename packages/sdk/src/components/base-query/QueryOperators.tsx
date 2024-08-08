import { Button } from '@teable/ui-lib';
import { useContext, useMemo } from 'react';
import type { QueryEditorKey } from './context/QueryEditorContext';
import { QueryEditorContext } from './context/QueryEditorContext';
import { useQueryOperatorsStatic } from './useQueryOperatorsStatic';

export const QueryOperators = () => {
  const { status, setStatus } = useContext(QueryEditorContext);

  const queryButtons = useQueryOperatorsStatic();
  const onButtonClick = (button: QueryEditorKey) => {
    setStatus(button, !status[button]);
  };

  const isSelectedAll = useMemo(() => {
    return queryButtons.every((button) => status[button.key]);
  }, [queryButtons, status]);

  if (isSelectedAll) {
    return;
  }

  return (
    <div className="flex flex-wrap gap-4 gap-y-2 px-4">
      {queryButtons.map(
        (button) =>
          !status[button.key] && (
            <Button
              className="text-[13px]"
              key={button.key}
              size="xs"
              variant="outline"
              onClick={() => onButtonClick(button.key)}
            >
              {button.label}
            </Button>
          )
      )}
    </div>
  );
};
