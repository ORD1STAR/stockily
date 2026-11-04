import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [TenancyModule, InvoicingModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
