import { allActions } from '@teable/core';
import { z } from '../zod';

export const accessTokenScopesSchema = z.array(z.enum(allActions)).min(1);
