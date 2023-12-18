import { useTranslation } from 'next-i18next';

export const useSdkLocale = () => {
  const { i18n } = useTranslation();
  return i18n.getDataByLanguage(i18n.language)?.sdk;
};
