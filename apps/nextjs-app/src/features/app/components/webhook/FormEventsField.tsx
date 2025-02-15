import {
  Checkbox,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RadioGroup,
  RadioGroupItem,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import type { ControllerRenderProps, FieldValues } from 'react-hook-form';
import { useFormContext } from 'react-hook-form';
import type { WebhookEventPayload } from '@/features/tempfile';
import { defaultEvents, EventsByWebhook } from '@/features/tempfile';

export function FormEventsField() {
  const form = useFormContext();
  const { t } = useTranslation(['webhook']);
  const [customEventVisible, setCustomEventVisible] = useState(false);

  const handleRadioValueChange = (
    value: string,
    field: ControllerRenderProps<FieldValues, 'events'>
  ) => {
    switch (value) {
      case 'record_event':
        field.onChange(defaultEvents);
        setCustomEventVisible(false);
        break;
      case 'all_event':
        field.onChange(EventsByWebhook);
        setCustomEventVisible(false);
        break;
      case 'custom_event':
        field.onChange([]);
        setCustomEventVisible(true);
        break;
    }
  };

  const RadioItem = ({ value, label }: { value: string; label: string }) => (
    <FormItem className="flex items-center space-x-3 space-y-0">
      <FormControl>
        <RadioGroupItem value={value} />
      </FormControl>
      <FormLabel className="cursor-pointer font-normal">{label}</FormLabel>
    </FormItem>
  );

  const CheckboxOption = ({
    field,
    item,
  }: {
    field: ControllerRenderProps<FieldValues, 'events'>;
    item: WebhookEventPayload;
  }) => (
    <FormItem className="flex flex-row items-start space-x-3 space-y-0 py-1 pl-5">
      <FormControl>
        <Checkbox
          checked={field.value?.includes(item)}
          onCheckedChange={(checked) =>
            field.onChange(
              checked
                ? [...field.value, item]
                : field.value?.filter((value: WebhookEventPayload) => value !== item)
            )
          }
        />
      </FormControl>
      <div className="space-y-1 leading-none">
        <FormLabel className="cursor-pointer">{t(`${item}.title`)}</FormLabel>
        <FormDescription>{t(`${item}.description`)}</FormDescription>
      </div>
    </FormItem>
  );

  return (
    <FormField
      control={form.control}
      name="events"
      render={({ field }) => (
        <FormItem className="space-y-3">
          <FormLabel>Which events would you like to trigger this webhook?</FormLabel>
          <FormControl>
            <RadioGroup
              onValueChange={(value) => handleRadioValueChange(value, field)}
              defaultValue="record_event"
              className="flex flex-col space-y-1"
            >
              <RadioItem value="record_event" label="Just the push event." />
              <RadioItem value="all_event" label="Send me everything." />
              <RadioItem value="custom_event" label="Let me select individual events." />
              {customEventVisible && (
                <FormItem className="ml-2 grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-1">
                  {EventsByWebhook.map((item, index) => (
                    <CheckboxOption item={item} field={field} key={index} />
                  ))}
                </FormItem>
              )}
            </RadioGroup>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
