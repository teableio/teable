import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fieldColorValues } from '@teable/v2-core';
import type { FieldFormApi } from '../FieldForm';

export function RatingOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <form.Field
        name="options.max"
        children={(field) => (
          <div className="space-y-2">
            <Label>Max Rating</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={(field.state.value as number) ?? 5}
              onChange={(e) => field.handleChange(parseInt(e.target.value) as any)}
            />
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Field
        name="options.icon"
        children={(field) => (
          <div className="space-y-2">
            <Label>Icon</Label>
            <Select
              value={(field.state.value as string) || 'star'}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="star">Star</SelectItem>
                <SelectItem value="heart">Heart</SelectItem>
                <SelectItem value="smile">Smile</SelectItem>
                <SelectItem value="flag">Flag</SelectItem>
                <SelectItem value="fire">Fire</SelectItem>
                <SelectItem value="thumbUp">Thumb Up</SelectItem>
              </SelectContent>
            </Select>
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
            <Label>Color</Label>
            <Select
              value={(field.state.value as string) || 'yellowBright'}
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
    </div>
  );
}
