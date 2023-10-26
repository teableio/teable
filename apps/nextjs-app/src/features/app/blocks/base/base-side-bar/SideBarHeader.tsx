/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useQuery } from '@tanstack/react-query';
import { ChevronsLeft, TeableNew } from '@teable-group/icons';
import { getBaseById } from '@teable-group/openapi';
import { useIsHydrated } from '@teable-group/sdk';
import { useRouter } from 'next/router';
import { ThemePicker } from '../../../components/ThemePicker';

export const SideBarHeader: React.FC = () => {
  const isHydrated = useIsHydrated();
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const { data } = useQuery({
    queryKey: ['base', baseId],
    queryFn: ({ queryKey }) => getBaseById(queryKey[1]),
  });

  const backSpace = () => {
    router.push({
      pathname: '/space',
    });
  };

  return (
    <div className="m-2 flex items-center gap-1">
      <div className="group relative h-6 w-6 shrink-0 cursor-pointer" onClick={backSpace}>
        <div className="absolute top-0 h-6 w-6 group-hover:opacity-0">
          {data?.data.icon ? (
            <div className="text-2xl leading-none">{data?.data.icon}</div>
          ) : (
            <TeableNew className="h-6 w-6" />
          )}
        </div>
        <ChevronsLeft className="absolute top-0 h-6 w-6 opacity-0 group-hover:opacity-100" />
      </div>
      <p className="truncate text-sm">{data?.data.name}</p>
      <div className="grow basis-0"></div>
      {isHydrated && <ThemePicker className="px-1" />}
    </div>
  );
};
