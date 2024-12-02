import { Logger } from '@nestjs/common';
import { createAxios } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

export class ReadonlyService {
  private readonly logger = new Logger(ReadonlyService.name);

  protected axios;
  constructor(clsService: ClsService<IClsStore>) {
    this.axios = createAxios();
    this.axios.interceptors.request.use((config) => {
      const cookie = clsService.get('cookie');
      config.headers.cookie = cookie;
      config.baseURL = `http://localhost:${process.env.PORT}/api`;
      if (!cookie) {
        this.logger.error('Auth session cookie is not found in request headers');
      }
      return config;
    });
  }
}
