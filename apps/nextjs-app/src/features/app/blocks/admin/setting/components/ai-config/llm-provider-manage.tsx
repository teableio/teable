import type { LLMProvider } from '@teable/openapi/src/admin/setting';
import { Button } from '@teable/ui-lib/shadcn';
import { SlidersHorizontalIcon, XIcon } from 'lucide-react';

import { NewLLMProviderForm, UpdateLLMProviderForm } from './new-llm-provider-form';

interface ILLMProviderManageProps {
  value: LLMProvider[];
  onChange: (value: LLMProvider[]) => void;
}

export const LLMProviderManage = ({ value, onChange }: ILLMProviderManageProps) => {
  const handleAdd = (data: LLMProvider) => {
    const newData = [...value, data];
    onChange(newData);
  };

  const handleUpdate = (index: number) => (data: LLMProvider) => {
    const newData = value.map((provider, i) => (i === index ? data : provider));
    onChange(newData);
  };
  const handleRemove = (index: number) => {
    const newData = value.filter((_, i) => i !== index);
    onChange(newData);
  };
  if (value.length === 0) {
    return <NewLLMProviderForm onAdd={handleAdd} />;
  }
  return (
    <div>
      <div className="flex max-w-lg flex-col gap-2">
        {value.map((provider, index) => (
          <div
            className="group flex w-full justify-between gap-2 rounded-sm p-1 hover:ring"
            key={provider.name}
          >
            <div>
              {provider.name} - {provider.type}
            </div>
            <div className="flex gap-2 opacity-70">
              <Button
                onClick={() => handleRemove(index)}
                size="xs"
                variant="ghost"
                className=" opacity-0 group-hover:opacity-100"
              >
                <XIcon className="size-4" />
              </Button>
              <UpdateLLMProviderForm value={provider} onChange={handleUpdate(index)}>
                <Button size="xs" variant="ghost">
                  <SlidersHorizontalIcon className="size-4" />
                </Button>
              </UpdateLLMProviderForm>
            </div>
          </div>
        ))}
        <NewLLMProviderForm onAdd={handleAdd} />
      </div>
    </div>
  );
};
