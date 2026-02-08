import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TIME_ZONE_LIST } from '@teable/v2-core';
import type { FieldFormApi } from '../FieldForm';

export function FormulaOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <form.Field
        name="options.expression"
        children={(field) => (
          <div className="space-y-2">
            <Label>Formula Expression</Label>
            <Textarea
              value={(field.state.value as string) || ''}
              onChange={(e) => field.handleChange(e.target.value as any)}
              placeholder="e.g. {Field1} + {Field2}"
            />
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Field
        name="options.timeZone"
        children={(field) => (
          <div className="space-y-2">
            <Label>Time Zone</Label>
            <Select
              value={(field.state.value as string) || 'utc'}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {TIME_ZONE_LIST.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <p className="text-xs text-muted-foreground">
        Formatting and Show As options are automatically inferred based on the formula result type
        in this version.
      </p>
    </div>
  );
}
