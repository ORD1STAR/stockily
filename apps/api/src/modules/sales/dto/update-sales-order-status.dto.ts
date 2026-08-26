import { IsBoolean, IsIn, IsOptional } from 'class-validator';

// Only cancellation and quote->order promotion are exposed as explicit
// status transitions — "partially_invoiced"/"invoiced" are derived
// automatically from invoicing (InvoicingService.finalizeInvoice), never
// set directly through this endpoint.
export class UpdateSalesOrderStatusDto {
  @IsIn(['cancelled', 'promote'])
  action!: 'cancelled' | 'promote';

  // Same "aperçu puis confirmation" contract as CreateSalesOrderDto — a
  // promotion reserves stock for the first time (a devis reserved nothing),
  // so it can hit the same 409 shortage response; set this to proceed
  // despite a shortage once the user has confirmed it.
  @IsOptional()
  @IsBoolean()
  acknowledgeShortage?: boolean;
}
