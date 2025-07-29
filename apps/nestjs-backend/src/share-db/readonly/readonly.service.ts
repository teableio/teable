import { BadRequestException, Logger } from '@nestjs/common';
import { createAxios } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { RawOpType } from '../interface';

export class ReadonlyService {
  private readonly logger = new Logger(ReadonlyService.name);

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

  formatVersionAndType(record?: { version: number; deletedTime: Date | null } | null): {
    version: number;
    type: RawOpType;
  } {
    if (!record) {
      return { version: -1, type: RawOpType.Del };
    }
    const { version, deletedTime } = record;
    if (version < 1) {
      throw new BadRequestException('Version is less than 1');
    }

    if (deletedTime) {
      return { version: version - 1, type: RawOpType.Del };
    }

    if (version === 1) {
      return { version: 0, type: RawOpType.Create };
    }
    return { version: version - 1, type: RawOpType.Edit };
  }
}
