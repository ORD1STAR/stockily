import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  // Deliberately outside the /api prefix (see main.ts's setGlobalPrefix
  // exclude) — a container orchestrator's health check shouldn't need to
  // know the app's own API versioning/prefix scheme. Checks a real DB
  // round-trip, not just "the Node process is alive" — the failure mode
  // that actually matters for a stateful service is the database being
  // unreachable while the process itself is still running.
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', message: 'Database unreachable' });
    }
  }
}
