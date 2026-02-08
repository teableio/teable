import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { FieldFormApi } from '../FieldForm';

export function CheckboxOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <form.Field
        name="options.defaultValue"
        children={(field) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={field.name}>Default Value</Label>
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
