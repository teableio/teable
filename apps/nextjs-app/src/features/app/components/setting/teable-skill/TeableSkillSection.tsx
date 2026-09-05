import { useTranslation } from 'next-i18next';
import { SettingTabShell } from '@/features/app/components/setting/SettingTabShell';
import { TeableSkillContent } from './TeableSkillContent';

export const TeableSkillSection = () => {
  const { t } = useTranslation('common');

  return (
    <SettingTabShell title={t('settings.setting.teableSkill')}>
      <TeableSkillContent showTitle={false} />
    </SettingTabShell>
  );
};
