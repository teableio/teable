/* eslint-disable @typescript-eslint/naming-convention */
import type { Provider } from '@nestjs/common';
import { InitBootstrapService } from './init-bootstrap.service';

export const InitBootstrapProvider: Provider = {
  provide: InitBootstrapService,
  useFactory: async () => {
    const initBootstrapService = new InitBootstrapService();

    await initBootstrapService.init();

    return initBootstrapService;
  },
  inject: [],
};
