import { Button } from '@teable/ui-lib/shadcn/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn/ui/dropdown-menu';
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
  const setLanguage = (value: string) => {
    if (value === 'default') {
      setCookie();
    } else {
      setCookie(value);
      i18n.changeLanguage(value);
    }
    toast.message(t('actions.updateSucceed'));
    window.location.reload();
  };

  const currentLanguage = i18n.language.split('-')[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={className} variant="outline">
          {languages.find((item) => item.key == currentLanguage)?.title || 'default'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuRadioGroup
          value={currentLanguage}
          onValueChange={(value) => {
            setLanguage(value);
          }}
        >
          {languages.map((item) => {
            return (
              <DropdownMenuRadioItem
                key={item.key}
                disabled={currentLanguage === item.key}
                value={item.key}
              >
                {item.title}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
