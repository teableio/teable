import { useTranslation } from '../../context/app/i18n';

interface IColorProps {
  children: (text: string, isActive: boolean) => React.ReactNode;
}

export const Color = (props: IColorProps) => {
  const { children } = props;
  const { t } = useTranslation();

  return children(t('color.label'), false);
};
