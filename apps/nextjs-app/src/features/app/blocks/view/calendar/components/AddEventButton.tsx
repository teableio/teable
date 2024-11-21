import { FieldKeyType } from '@teable/core';
import { Plus } from '@teable/icons';
import type { DateField } from '@teable/sdk/model';
import { Record } from '@teable/sdk/model';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { createPortal } from 'react-dom';

interface IAddEventButtonProps {
  date: Date;
  containerEl: HTMLElement;
  tableId?: string;
  startDateField?: DateField;
  endDateField?: DateField;
  setExpandRecordId?: (id: string) => void;
}

export const ADD_EVENT_BUTTON_CLASS_NAME = 'add-event-btn';

export const AddEventButton = (props: IAddEventButtonProps) => {
  const { date, tableId, startDateField, endDateField, containerEl, setExpandRecordId } = props;

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!tableId || !startDateField || !endDateField) return;

    const { data } = await Record.createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [startDateField.id]: date.toISOString(),
            [endDateField.id]: date.toISOString(),
          },
        },
      ],
    });

    setExpandRecordId?.(data.records[0].id);
  };

  return createPortal(
    <Button
      size="sm"
      variant="secondary"
      className={cn(
        ADD_EVENT_BUTTON_CLASS_NAME,
        'invisible absolute left-[2px] top-[2px] z-10 size-5 rounded-sm p-0'
      )}
      onClick={onClick}
    >
      <Plus className="size-4" />
    </Button>,
    containerEl
  );
};
