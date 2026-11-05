import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// A dedicated Prisma client on DATABASE_URL — the `stockily` superuser role,
// which BYPASSES Row-Level Security. The platform admin is cross-tenant by
// nature (it manages every org), so it must NOT go through the normal,
// RLS-scoped PrismaService (that would return zero rows with no tenant set).
// This is the same technique the desktop sync engine uses (local-sync's
// `this.admin`). Only ever instantiated inside AdminModule, which is not
// loaded in local/desktop mode.
@Injectable()
export class AdminPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminPrismaService.name);

  constructor() {
    super({ datasourceUrl: process.env.DATABASE_URL });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Admin (superuser) database client connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
