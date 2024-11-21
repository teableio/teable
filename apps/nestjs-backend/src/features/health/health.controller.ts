import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '@teable/db-main-prisma';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly prismaService: PrismaService
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck('database', this.prismaService)]);
  }

  @Get('memory')
  memory() {
    return {
      memoryUsage: process.memoryUsage(),
      pod: process.env.HOSTNAME,
    };
  }
}
