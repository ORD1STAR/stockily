import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// Creating a transfer moves the ledger atomically (both legs) at creation
// time — StockTransfer.status below is a logistics/tracking status,
// decoupled from the ledger itself (see docs/MILESTONE_2.md for why: the
// three-phase "prepared -> in_transit -> delivered" physical-custody model
// is real but a bigger scope than this milestone needs; a future Livraisons
// module, Phase 2, can refine it into a staged/in-transit-holding model).
export class CreateTransferDto {
  @IsString()
  productId!: string;

  @IsString()
  fromSiteId!: string;

  @IsString()
  toSiteId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  batchId?: string;
}
