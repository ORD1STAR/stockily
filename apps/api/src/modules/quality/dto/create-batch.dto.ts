import { IsISO8601, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// A new lot at receipt. quantityReceived is descriptive here (matches
// Batch.quantityReceived) — actually adding stock to `stock_levels` still
// requires a separate POST /stock/movements (type: IN, batchId: <this
// batch's id>) call, same "no endpoint bypasses the ledger" rule as
// everything else (docs/Action Plan.md §9 decision #10).
export class CreateBatchDto {
  @IsString()
  productId!: string;

  @IsString()
  lotNumber!: string;

  @IsOptional()
  @IsISO8601()
  expiryDate?: string;

  @IsNumber()
  @IsPositive()
  quantityReceived!: number;
}
