import { dehydrate } from '@tanstack/react-query';
import { getDefaultNodeUrl, redirect } from './helper';
import type { ISSRContext, SSRResult } from './types';

export const getBaseServerSideProps = async (ctx: ISSRContext): Promise<SSRResult> => {
  const { base } = ctx;

  // Try to redirect to the default node (last visited or first non-folder node)
  const defaultUrl = await getDefaultNodeUrl(ctx);
  if (defaultUrl) {
    return redirect(defaultUrl);
  }

  return {
    props: {
      ...(await ctx.getTranslationsProps()),
      dehydratedState: dehydrate(ctx.queryClient),
      base,
    },
  };
};
