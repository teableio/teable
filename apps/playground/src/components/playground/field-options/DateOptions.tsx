import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TIME_ZONE_LIST } from '@teable/v2-core';
import type { FieldFormApi } from '../FieldForm';

export function DateOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <form.Field
        name="options.formatting.date"
        children={(field) => (
          <div className="space-y-2">
            <Label>Date Format</Label>
            <Select
              value={(field.state.value as string) || 'YYYY-MM-DD'}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="YYYY-MM-DD">2023-12-24</SelectItem>
                <SelectItem value="MM/DD/YYYY">12/24/2023</SelectItem>
                <SelectItem value="DD/MM/YYYY">24/12/2023</SelectItem>
                <SelectItem value="YYYY/MM/DD">2023/12/24</SelectItem>
              </SelectContent>
            </Select>
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Field
        name="options.formatting.time"
        children={(field) => (
          <div className="space-y-2">
            <Label>Time Format</Label>
            <Select
              value={(field.state.value as string) || 'None'}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="None">None</SelectItem>
                <SelectItem value="Hour24">24 Hour (13:00)</SelectItem>
                <SelectItem value="Hour12">12 Hour (1:00 PM)</SelectItem>
              </SelectContent>
            </Select>
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Field
        name="options.formatting.timeZone"
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

      <form.Field
        name="options.defaultValue"
        children={(field) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={field.name}>Default to "Now"</Label>
              <Switch
                id={field.name}
                checked={field.state.value === 'now'}
                onCheckedChange={(checked) =>
                  field.handleChange(checked ? ('now' as any) : (undefined as any))
                }
              />
            </div>
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />
    </div>
  );
}
