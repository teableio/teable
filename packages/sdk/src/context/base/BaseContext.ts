import type { IGetBasePermissionVo } from '@teable/openapi';
import { createContext } from 'react';
import type { Base } from '../../model';

export const BaseContext = createContext<{
  base?: Base;
  permission?: IGetBasePermissionVo;
}>({});
