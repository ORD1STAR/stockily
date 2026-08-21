import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtConfigModule } from '../config/jwt-config.module';
import { AuthModule } from '../modules/auth/auth.module';
import { TenancyModule } from '../modules/tenancy/tenancy.module';
import { StockModule } from '../modules/stock/stock.module';
import { QualityModule } from '../modules/quality/quality.module';
import { InvoicingModule } from '../modules/invoicing/invoicing.module';
import { SitesModule } from '../modules/sites/sites.module';
import { ScanModule } from '../modules/scan/scan.module';
import { AuditModule } from '../modules/audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    JwtConfigModule,
    AuthModule,
    TenancyModule,
    AuditModule,
    // Phase 1 product modules (docs/Action Plan.md §1, §7)
    StockModule,
    QualityModule,
    InvoicingModule,
    SitesModule,
    ScanModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
