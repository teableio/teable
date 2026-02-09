import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldFormApi } from '../FieldForm';

export function SingleLineTextOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <form.Field
        name="options.showAs.type"
        children={(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Show As</Label>
            <Select
              value={(field.state.value as string) || 'none'}
              onValueChange={(value) =>
                field.handleChange(value === 'none' ? (undefined as any) : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select display type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="url">URL</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="none">None</SelectItem>
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
            <Label htmlFor={field.name}>Default Value</Label>
            <Input
              id={field.name}
              value={(field.state.value as string) || ''}
              onChange={(e) => field.handleChange(e.target.value as any)}
              placeholder="Enter default value"
            />
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />
    </div>
  );
}
