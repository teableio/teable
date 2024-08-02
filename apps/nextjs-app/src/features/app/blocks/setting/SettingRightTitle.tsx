import { ArrowLeft } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import Head from 'next/head';

interface ISettingRightTitle {
  title?: string | React.ReactNode;
  onBack?: () => void;
}
export const SettingRightTitle = (props: ISettingRightTitle) => {
  const { title, onBack } = props;
  return (
    <div className="flex h-16 flex-1 items-center gap-x-4">
      {onBack && (
        <Button className="px-0 text-base" variant={'link'} onClick={onBack}>
          <ArrowLeft />
        </Button>
      )}
      <Head>
        <title>{title}</title>
      </Head>
      <h2 className="flex-1 text-base">{title}</h2>
    </div>
  );
};
