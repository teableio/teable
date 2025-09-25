import { Controller, Get, Logger } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '@teable/db-main-prisma';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
@Public()
export class HealthController {
  private logger = new Logger(HealthController.name);
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly prismaService: PrismaService
  ) {}

  @Get()
  @HealthCheck()
  check() {
    try {
      return this.health.check([() => this.db.pingCheck('database', this.prismaService)]);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Get('memory')
  memory() {
    return {
      memoryUsage: process.memoryUsage(),
      pod: process.env.HOSTNAME,
    };
  }
}
