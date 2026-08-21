import { IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';

// Exactly one of productId/batchId — a label identifies either a product
// (for a generic item, printed once and reused across receipts) or a
// specific batch (a lot-tracked receipt's own label, since the lot number
// is what's physically printed on that batch's boxes) — never both.
export class GenerateLabelDto {
  @ValidateIf((o) => !o.batchId)
  @IsString()
  productId?: string;

  @ValidateIf((o) => !o.productId)
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsIn(['EAN13', 'QR'])
  symbology?: 'EAN13' | 'QR';
}
