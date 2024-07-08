import { Plus, Trash2 } from '@teable/icons';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';

interface ICallbackEditorProps {
  value: string[];
  onChange?: (callbackURLs: string[]) => void;
}

export const CallbackEditor = (props: ICallbackEditorProps) => {
  const { value, onChange } = props;
  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);
  const [callbackURLs, setCallbackURLs] = useState(
    value.length === 0 ? [''] : value.map((url) => url || '')
  );

  const change = (value: string[]) => {
    setCallbackURLs(value);
    onChange?.(value);
  };

  const updateCallbackURL = (index: number, value: string) => {
    const newCallbackURLs = [...callbackURLs];
    newCallbackURLs[index] = value;
    change(newCallbackURLs);
  };

  const deleteCallbackURL = (index: number) => {
    if (callbackURLs.length === 1) {
      change(['']);
      return;
    }
    const newCallbackURLs = [...callbackURLs];
    newCallbackURLs.splice(index, 1);
    change(newCallbackURLs);
  };

  const addCallbackURL = () => {
    change([...callbackURLs, '']);
  };

  return (
    <>
      {callbackURLs.map((callbackURL, index) => (
        <div key={index} className="flex items-center gap-4">
          <Input
            className="h-8"
            type="text"
            value={callbackURL}
            onChange={(e) => updateCallbackURL(index, e.target.value)}
          />
          <Button variant={'destructive'} size={'xs'} onClick={() => deleteCallbackURL(index)}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        className="h-6 gap-0.5 text-[11px]"
        size={'xs'}
        variant={'ghost'}
        onClick={() => addCallbackURL()}
      >
        <Plus /> {t('oauth:form.callbackUrl.add')}
      </Button>
    </>
  );
};
