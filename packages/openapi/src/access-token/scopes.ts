import { allActions, accessTokenScopeMap } from '@teable/core';
import { z } from '../zod';

export const accessTokenScopesSchema = z
  .array(
    z.enum(allActions).refine((action) => !accessTokenScopeMap[action].platformSessionOnly, {
      message: 'This action requires a platform session',
    })
  )
  .min(1);
