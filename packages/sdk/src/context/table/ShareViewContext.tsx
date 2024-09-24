import type { ShareViewGetVo } from '@teable/openapi';
import React from 'react';

export const ShareViewContext = React.createContext<ShareViewGetVo>({} as ShareViewGetVo);
