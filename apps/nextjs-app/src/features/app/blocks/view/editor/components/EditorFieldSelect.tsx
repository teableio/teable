import { LongText } from '@teable/icons';
import type { IFieldInstance } from '@teable/sdk/model';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

interface EditorFieldSelectProps {
  fields: IFieldInstance[];
  selectedFieldId: string | null;
  onFieldSelect: (fieldId: string) => void;
}

export const EditorFieldSelect = ({
  fields,
  selectedFieldId,
  onFieldSelect,
}: EditorFieldSelectProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <Card className="w-[400px]">
      <CardHeader>
        <CardTitle className="text-lg">{t('table:editor.selectField.title')}</CardTitle>
        <CardDescription>{t('table:editor.selectField.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {fields.map((field) => (
            <Button
              key={field.id}
              variant={selectedFieldId === field.id ? 'default' : 'outline'}
              className="justify-start"
              onClick={() => onFieldSelect(field.id)}
            >
              <LongText className="mr-2 size-4" />
              {field.name}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
