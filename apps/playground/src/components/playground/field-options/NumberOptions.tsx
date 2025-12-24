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

export function NumberOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <form.Field
        name="options.formatting.type"
        children={(field) => (
          <div className="space-y-2">
            <Label>Formatting Type</Label>
            <Select
              value={(field.state.value as string) || 'decimal'}
              onValueChange={(value) => field.handleChange(value as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="decimal">Decimal</SelectItem>
                <SelectItem value="percent">Percent</SelectItem>
                <SelectItem value="currency">Currency</SelectItem>
              </SelectContent>
            </Select>
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Field
        name="options.formatting.precision"
        children={(field) => (
          <div className="space-y-2">
            <Label>Precision (0-5)</Label>
            <Input
              type="number"
              min={0}
              max={5}
              value={(field.state.value as number) ?? 2}
              onChange={(e) => field.handleChange(parseInt(e.target.value) as any)}
            />
            {field.state.meta.errors ? (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            ) : null}
          </div>
        )}
      />

      <form.Subscribe
        selector={(state) => (state.values.options as any)?.formatting?.type}
        children={(type) =>
          type === 'currency' ? (
            <form.Field
              name="options.formatting.symbol"
              children={(field) => (
                <div className="space-y-2">
                  <Label>Currency Symbol</Label>
                  <Input
                    value={(field.state.value as string) || '$'}
                    onChange={(e) => field.handleChange(e.target.value as any)}
                  />
                  {field.state.meta.errors ? (
                    <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
                  ) : null}
                </div>
              )}
            />
          ) : null
        }
      />

      <div className="space-y-2">
        <Label>Default Value</Label>
        <form.Field
          name="options.defaultValue"
          children={(field) => (
            <>
              <Input
                type="number"
                value={(field.state.value as number) ?? ''}
                onChange={(e) =>
                  field.handleChange(
                    e.target.value ? (parseFloat(e.target.value) as any) : (undefined as any)
                  )
                }
              />
              {field.state.meta.errors ? (
                <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
              ) : null}
            </>
          )}
        />
      </div>
    </div>
  );
}
