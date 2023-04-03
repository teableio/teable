import * as http from 'http';
import * as https from 'https';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response, Request } from 'express';

@Injectable()
export class ChatService {
  constructor(private readonly configService: ConfigService) {}
  async completions(req: Request, res: Response) {
    const openAIEndPoint = this.configService.get<string>('OPENAI_API_ENDPOINT');
    const openAiKey = this.configService.get<string>('OPENAI_API_KEY');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [protocol, hostname] = openAIEndPoint!.split('://');
    const options = {
      method: 'POST',
      hostname,
      path: '/v1/chat/completions',
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
    };
    // 获取请求数据
    const { body } = req;

    // 发送请求
    const proxyReq = (protocol === 'https' ? https : http).request(options, (proxyRes) => {
      // 将响应头传递给客户端
      res.set(proxyRes.headers);

      // 将响应流式传输到客户端
      proxyRes.pipe(res);
    });

    // 监听错误
    proxyReq.on('error', (error) => {
      console.error('Error while proxying request:', error);
      res.status(500).send('Error while proxying request');
    });

    // 将请求体写入代理请求
    proxyReq.write(JSON.stringify(body));

    // 结束代理请求
    proxyReq.end();
  }
}
