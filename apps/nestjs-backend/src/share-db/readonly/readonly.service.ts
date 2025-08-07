import { createAxios } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

export class ReadonlyService {
  protected axios;
  constructor(clsService: ClsService<IClsStore>) {
    this.axios = createAxios();
    this.axios.interceptors.request.use((config) => {
      const cookie = clsService.get('cookie');
      config.headers.cookie = cookie;
      config.baseURL = `http://localhost:${process.env.PORT}/api`;
      return config;
    });
  }
}
