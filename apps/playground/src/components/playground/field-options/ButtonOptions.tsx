import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { fieldColorValues } from '@teable/v2-core';
import type { FieldFormApi } from '../FieldForm';

export function ButtonOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <form.Field
        name="options.label"
        children={(field) => (
          <div className="space-y-2">
            <Label>Button Label</Label>
            <Input
              value={(field.state.value as string) || ''}
              onChange={(e) => field.handleChange(e.target.value as any)}
              placeholder="e.g. Click Me"
            />
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Field
        name="options.color"
        children={(field) => (
          <div className="space-y-2">
            <Label>Button Color</Label>
            <Select
              value={(field.state.value as string) || 'blueBright'}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fieldColorValues.map((color) => (
                  <SelectItem key={color} value={color}>
                    {color}
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
        name="options.maxCount"
        children={(field) => (
          <div className="space-y-2">
            <Label>Max Click Count</Label>
            <Input
              type="number"
              value={(field.state.value as number) ?? ''}
              onChange={(e) =>
                field.handleChange(
                  e.target.value ? (parseInt(e.target.value) as any) : (undefined as any)
                )
              }
              placeholder="Unlimited if empty"
            />
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Field
        name="options.resetCount"
        children={(field) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={field.name}>Reset Count Daily</Label>
              <Switch
                id={field.name}
                checked={(field.state.value as boolean) || false}
                onCheckedChange={(checked) => field.handleChange(checked as any)}
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
