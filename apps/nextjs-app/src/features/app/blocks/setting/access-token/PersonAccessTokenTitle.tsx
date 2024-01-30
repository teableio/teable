import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { IFormType } from './form/AccessTokenForm';

interface IPersonAccessTokenTitleProps {
  backList: () => void;
}

export const PersonAccessTokenTitle = (props: IPersonAccessTokenTitleProps) => {
  const { backList } = props;
  const router = useRouter();
  const formType = router.query.form as IFormType;
  const { t } = useTranslation('token');

  const PersonAccessTokenButtonCom = () => (
    <Button className="px-0 text-base" variant={'link'} onClick={backList}>
      {t('title')}
    </Button>
  );

  switch (formType) {
    case 'new':
      return (
        <div className="flex items-center gap-2">
          <PersonAccessTokenButtonCom />/<h2 className="flex items-center">{t('new.title')}</h2>
        </div>
      );
    case 'edit':
      return (
        <div className="flex items-center gap-2">
          <PersonAccessTokenButtonCom />/<h2 className="flex items-center">{t('edit.title')}</h2>
        </div>
      );
    default:
      return t('title');
  }
};
