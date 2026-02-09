import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { FieldFormApi } from '../FieldForm';

export function UserOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <form.Field
        name="options.isMultiple"
        children={(field) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={field.name}>Multiple Users</Label>
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

      <form.Field
        name="options.shouldNotify"
        children={(field) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={field.name}>Notify Users</Label>
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
