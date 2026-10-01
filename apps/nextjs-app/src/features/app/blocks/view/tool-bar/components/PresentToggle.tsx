import { Maximize2, Minimize2 } from '@teable/icons';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { usePresentationMode } from '../../gallery/context/PresentationModeContext';
import { ToolBarButton } from '../ToolBarButton';

export const PresentToggle = () => {
  const { isPresenting, setPresenting } = usePresentationMode();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <ToolBarButton
      isActive={isPresenting}
      text={
        isPresenting ? t('table:gallery.toolbar.exitPresent') : t('table:gallery.toolbar.present')
      }
      onClick={() => setPresenting(!isPresenting)}
      textClassName="@2xl/toolbar:inline"
    >
      {isPresenting ? (
        <Minimize2 className="size-4 text-sm" />
      ) : (
        <Maximize2 className="size-4 text-sm" />
      )}
    </ToolBarButton>
  );
};
