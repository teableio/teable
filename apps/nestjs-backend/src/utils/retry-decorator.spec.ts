/* eslint-disable sonarjs/no-identical-functions */
import { Prisma } from '@prisma/client';
import { retryOnDeadlock } from './retry-decorator';

class TestService {
  @retryOnDeadlock()
  async testMethod() {
    throw new Prisma.PrismaClientKnownRequestError('Simulated deadlock', {
      code: '40P01',
      clientVersion: '1.0.0',
    });
  }

  // 300ms backoff time is determined through testing, 3 retries take approximately 4s in total
  @retryOnDeadlock({
    maxRetries: 3,
    initialBackoff: 300,
    jitter: 1.0,
  })
  async testMethod2() {
    throw new Prisma.PrismaClientKnownRequestError('Simulated deadlock', {
      code: '40P01',
      clientVersion: '1.0.0',
    });
  }
}

describe('RetryOnDeadlock Decorator', () => {
  let service: TestService;

  beforeEach(() => {
    service = new TestService();
  });

  beforeAll(() => {
    vitest.mock('./threshold.config', () => ({
      thresholdConfig: () => ({
        dbDeadlock: {
          maxRetries: 3,
          initialBackoff: 200,
          jitter: 1,
        },
      }),
    }));
  });

  it('should retry on deadlock error', async () => {
    await expect(service.testMethod()).rejects.toThrow('Database deadlock detected');
  });

  it('should retry on deadlock error with custom backoff', async () => {
    await expect(service.testMethod2()).rejects.toThrow('Database deadlock detected');
  });
});
