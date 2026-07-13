import { SettingTabShell } from '@/features/app/components/setting/SettingTabShell';
import { TeableSkillContent } from './TeableSkillContent';

export const TeableSkillSection = () => {
  return (
    <SettingTabShell contentClassName="pt-0">
      <TeableSkillContent />
    </SettingTabShell>
  );
};
