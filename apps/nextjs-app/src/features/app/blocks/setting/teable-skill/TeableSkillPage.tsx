import { useTranslation } from 'next-i18next';
import { TeableSkillContent } from '@/features/app/components/setting/teable-skill';
import { settingConfig } from '@/features/i18n/setting.config';
import { SettingRight } from '../SettingRight';
import { SettingRightTitle } from '../SettingRightTitle';

export const TeableSkillPage = () => {
  const { t } = useTranslation(settingConfig.i18nNamespaces);

  return (
    <SettingRight
      contentClassName="py-0"
      header={<SettingRightTitle title={t('common:settings.setting.teableSkill')} />}
    >
      <TeableSkillContent />
    </SettingRight>
  );
};
