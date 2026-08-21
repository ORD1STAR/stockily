import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// A manual stock-count correction — still goes through the same
// immutable-ledger + offsetting-movement mechanism as everything else (§9
// decision #10): no endpoint anywhere edits `stock_levels` directly.
export class CreateInventoryAdjustmentDto {
  @IsString()
  productId!: string;

  @IsString()
  siteId!: string;

  @IsIn(['increase', 'decrease'])
  direction!: 'increase' | 'decrease';

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
