import { useMutation } from '@tanstack/react-query';
import { updateUserLang } from '@teable/openapi';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn/ui/select';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';

const languages = [
  { key: 'zh', title: '中文' },
  { key: 'en', title: 'English' },
  { key: 'it', title: 'Italiano' },
  { key: 'fr', title: 'Français' },
  { key: 'de', title: 'Deutsch' },
  { key: 'ja', title: '日本語' },
  { key: 'ru', title: 'Русский' },
  { key: 'uk', title: 'Українська' },
  { key: 'tr', title: 'Türkçe' },
  { key: 'es', title: 'Español (Latinoamérica)' },
  { key: 'default', title: 'Default' },
];

const setCookie = (locale?: string) => {
  if (!locale) {
    document.cookie = `NEXT_LOCALE=; max-age=0; path=/`;
  } else {
    document.cookie = `NEXT_LOCALE=${locale}; max-age=31536000; path=/`;
  }
};

export const LanguagePicker: React.FC<{ className?: string }> = ({ className }) => {
  const { t, i18n } = useTranslation('common');

  const { mutateAsync: updateLangMutate } = useMutation({
    mutationFn: (ro: { lang: string }) => updateUserLang(ro),
    onSuccess: (_data, variables) => {
      setCookie(variables.lang);
      i18n.changeLanguage(variables.lang);
      toast.message(t('actions.updateSucceed'));
      window.location.reload();
    },
  });

  const setLanguage = (value: string) => {
    const lang = value === 'default' ? '' : value;
    updateLangMutate({ lang });
  };

  const currentLanguage = i18n.language.split('-')[0];
  const selectedValue = languages.some((l) => l.key === currentLanguage)
    ? currentLanguage
    : 'default';

  return (
    <Select value={selectedValue} onValueChange={setLanguage}>
      <SelectTrigger className={`w-full max-w-[320px] ${className || ''}`}>
        <SelectValue placeholder="Select Language" />
      </SelectTrigger>
      <SelectContent>
        {languages.map((item) => (
          <SelectItem key={item.key} value={item.key}>
            {item.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
