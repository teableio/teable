import type { IWebhookListVo } from '@teable/openapi';
import { GET_WEBHOOK_LIST, urlBuilder } from '@teable/openapi';
import type { AxiosInstance } from 'axios';

export class WebhookSsr {
  private axios: AxiosInstance;

  constructor(axios: AxiosInstance) {
    this.axios = axios;
  }

  async getWebhookList(spaceId: string) {
    return this.axios
      .get<IWebhookListVo>(urlBuilder(GET_WEBHOOK_LIST, { spaceId }))
      .then(({ data }) => data);
  }
}
