import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, MinLength, ValidateNested } from 'class-validator';

// A new lot created as part of receiving this line — same fields as
// CreateBatchDto (Quality), deliberately not reused directly: this is a
// nested object here, not a whole request body.
export class ReceiptNewLotDto {
  @IsString()
  @MinLength(1)
  lotNumber!: string;

  @IsOptional()
  @IsISO8601()
  expiryDate?: string;
}

export class CreatePurchaseReceiptLineDto {
  // Present when receiving against a specific PurchaseOrder line (updates
  // its quantityReceived); absent for "réception libre" (no PO at all) or
  // for a line not tied to any single ordered line.
  @IsOptional()
  @IsString()
  purchaseOrderLineId?: string;

  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  unitCost!: number; // feeds Weighted Average Cost via StockService.recordMovement

  // Exactly one of these, only when the product isLotTracked — never both.
  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiptNewLotDto)
  newLot?: ReceiptNewLotDto;

  @IsOptional()
  @IsString()
  existingBatchId?: string;

  // Optional receipt-time quality inspection, exactly like Scan's own new-lot
  // Entrée flow (Milestone 5) — reuses QualityService.recordQualityCheck,
  // no new Quality endpoint.
  @IsOptional()
  @IsIn(['conforme', 'non_conforme'])
  qualityResult?: 'conforme' | 'non_conforme';

  @IsOptional()
  @IsString()
  qualityNotes?: string;
}

export class CreatePurchaseReceiptDto {
  @IsOptional()
  @IsString()
  purchaseOrderId?: string; // absent = réception libre

  @IsString()
  siteId!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Milestone 10 (coût de revient) — one lump sum for this receipt's
  // transport/douane/assurance, pro-rated across lines by value (see
  // PurchasingService.receiveGoods). Absent/zero = identical behavior to
  // before this milestone.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  landedCostAmount?: number;

  @IsOptional()
  @IsString()
  landedCostNotes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReceiptLineDto)
  lines!: CreatePurchaseReceiptLineDto[];
}
