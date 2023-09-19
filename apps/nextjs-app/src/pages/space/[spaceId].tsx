import type { ReactElement } from 'react';
import { SpaceInnerPage } from '@/features/app/blocks/space';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import type { NextPageWithLayout } from '../_app';

const Space: NextPageWithLayout = () => {
  return <SpaceInnerPage />;
};

Space.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};

export default Space;
