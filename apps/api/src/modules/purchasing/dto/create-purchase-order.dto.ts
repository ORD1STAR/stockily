import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, MinLength, ValidateNested } from 'class-validator';

export class CreatePurchaseOrderLineDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantityOrdered!: number;

  @IsNumber()
  unitCost!: number;
}

export class CreatePurchaseOrderDto {
  @IsString()
  siteId!: string; // destination site

  @IsString()
  supplierId!: string; // a Partner with isSupplier = true

  @IsOptional()
  @IsISO8601()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderDto {
  // Only cancellation is exposed as a status transition from this endpoint
  // — "confirmed"/"partially_received"/"received" are derived automatically
  // from receipts (see PurchasingService.updatePurchaseOrderStatus), not
  // settable directly.
  @IsString()
  status!: 'cancelled';

  @IsOptional()
  @IsString()
  @MinLength(1)
  notes?: string;
}
