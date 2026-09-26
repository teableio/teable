import { dehydrate } from '@tanstack/react-query';
import { isEmbedModeRequest } from '@/lib/embed-mode';
import { getDefaultNodeUrl, redirect } from './helper';
import type { ISSRContext, SSRResult } from './types';

export const getBaseServerSideProps = async (ctx: ISSRContext): Promise<SSRResult> => {
  const { base } = ctx;

  // Inside the native mobile shell the directory tree is native: stay on the
  // base home (rendered as EmbedBaseHome) instead of jumping to a node.
  if (!isEmbedModeRequest(ctx.context)) {
    // Try to redirect to the default node (last visited or first non-folder node)
    const defaultUrl = await getDefaultNodeUrl(ctx);
    if (defaultUrl) {
      return redirect(defaultUrl);
    }
  }

  return {
    props: {
      ...(await ctx.getTranslationsProps()),
      dehydratedState: dehydrate(ctx.queryClient),
      base,
    },
  };
};
