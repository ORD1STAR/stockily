import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// A thin Nest lifecycle wrapper around the generated Prisma client. This
// lives in apps/api (not packages/infra-db) deliberately: it depends on
// @nestjs/common lifecycle hooks, and infra-db is meant to stay usable by a
// future Local/Electron adaptation that won't have Nest at all (docs/Action
// Plan.md §6). infra-db's own `createPrismaClient()` factory is the
// framework-agnostic piece; this class is the Nest-specific wiring on top.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from database');
  }
}
