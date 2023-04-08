import * as http from 'http';
import * as https from 'https';
import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response, Request } from 'express';

@Injectable()
export class ChatService {
  constructor(private readonly configService: ConfigService) {}
  async completions(req: Request, res: Response) {
    const openAIEndPoint = this.configService.get<string>('OPENAI_API_ENDPOINT');
    const openAiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!openAIEndPoint || !openAiKey) {
      throw new HttpException('OPENAI_API_ENDPOINT or OPENAI_API_KEY is undefined', 500);
    }

    const [protocol, hostname] = openAIEndPoint.split('://');
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

    const { body } = req;

    const proxyReq = (protocol === 'https' ? https : http).request(options, (proxyRes) => {
      res.set(proxyRes.headers);

      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      console.error('Error while proxying request:', error);
      res.status(500).send('Error while proxying request');
    });

    proxyReq.write(JSON.stringify(body));

    proxyReq.end();
  }
}
