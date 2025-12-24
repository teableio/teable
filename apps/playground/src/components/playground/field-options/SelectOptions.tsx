import { Plus, Trash2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fieldColorValues } from '@teable/v2-core';
import type { FieldFormApi } from '../FieldForm';

export function SelectOptions({ form }: { form: FieldFormApi }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Choices</Label>
        <form.Field
          name="options.choices"
          children={(field) => {
            const choices = (field.state.value as any[]) || [];
            return (
              <div className="space-y-2">
                {choices.map((choice: any, index: number) => (
                  <div key={index} className="flex gap-2 items-center">
                    <Input
                      placeholder="Choice name"
                      value={choice.name}
                      onChange={(e) => {
                        const newChoices = [...choices];
                        newChoices[index] = { ...choice, name: e.target.value };
                        field.handleChange(newChoices as any);
                      }}
                    />
                    <Select
                      value={choice.color}
                      onValueChange={(value) => {
                        const newChoices = [...choices];
                        newChoices[index] = { ...choice, color: value };
                        field.handleChange(newChoices as any);
                      }}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldColorValues.map((color) => (
                          <SelectItem key={color} value={color}>
                            <div className="flex items-center gap-2">
                              <div
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: color }}
                              />
                              <span className="text-xs">{color}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const newChoices = choices.filter((_: any, i: number) => i !== index);
                        field.handleChange(newChoices as any);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    field.handleChange([
                      ...choices,
                      {
                        name: '',
                        color: fieldColorValues[choices.length % fieldColorValues.length],
                      },
                    ] as any);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Choice
                </Button>
                {field.state.meta.errors ? (
                  <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
                ) : null}
              </div>
            );
          }}
        />
      </div>

      <form.Field
        name="options.preventAutoNewOptions"
        children={(field) => (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={field.name}>Prevent Auto-creation of Options</Label>
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
