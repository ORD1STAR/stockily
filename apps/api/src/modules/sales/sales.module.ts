import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuditModule } from '../audit/audit.module';
import { StockModule } from '../stock/stock.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

// Gestion Ventes (Milestone 10) — the customer-side mirror of Purchasing.
// Imports StockModule (reservation) and InvoicingModule (facture client
// from a commande) for their exported services — SalesService never
// constructs @org/domain-stock directly, same discipline as every other
// module that composes with Stock. One-directional: InvoicingModule must
// never import SalesModule back (see InvoicingModule's own comment) — the
// circular-dependency risk this avoids is the whole reason
// finalizeInvoice's SalesOrder bookkeeping is done with raw Prisma calls
// instead of injecting SalesService.
@Module({
  imports: [TenancyModule, AuditModule, StockModule, InvoicingModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
