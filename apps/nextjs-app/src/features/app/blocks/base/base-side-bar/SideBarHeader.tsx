/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useQuery } from '@tanstack/react-query';
import { ChevronsLeft, TeableNew } from '@teable-group/icons';
import { BaseApi, useIsHydrated } from '@teable-group/sdk';
import { useRouter } from 'next/router';
import { ThemePicker } from '../../../components/ThemePicker';

export const SideBarHeader: React.FC = () => {
  const isHydrated = useIsHydrated();
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const { data } = useQuery({
    queryKey: ['base', baseId],
    queryFn: ({ queryKey }) => BaseApi.getBaseById(queryKey[1]),
  });

  const backSpace = () => {
    router.push({
      pathname: '/space',
    });
  };

  return (
    <div className="flex m-2 gap-1 items-center">
      <div className="group w-6 h-6 relative shrink-0 cursor-pointer" onClick={backSpace}>
        <TeableNew className="absolute top-0 w-6 h-6 group-hover:opacity-0" />
        <ChevronsLeft className="absolute top-0 w-6 h-6 opacity-0 group-hover:opacity-100" />
      </div>
      <p className="text-sm overflow-hidden text-ellipsis whitespace-nowrap">{data?.data.name}</p>
      <div className="grow basis-0"></div>
      {isHydrated && <ThemePicker className="px-1" />}
    </div>
  );
};
