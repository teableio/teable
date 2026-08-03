import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  beforeApplicationShutdown(signal: string) {
    console.log(`health beforeApplicationShutdown ${signal}`);
  }

  onApplicationShutdown(signal: string) {
    console.log(`health onApplicationShutdown ${signal}`);
  }
}
