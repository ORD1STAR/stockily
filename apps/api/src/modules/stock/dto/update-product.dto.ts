import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Deliberately narrower than CreateProductDto — sku, categoryId and
// unitOfMeasure are genuinely structural, not editable here. isLotTracked
// used to be excluded on the same reasoning ("cascading implications once
// batches exist"), but nothing in domain-stock or domain-quality actually
// reads it to gate any business logic — it's a display/UX flag only (what
// the Stock/Quality/Scan UIs choose to show), not a data-integrity
// constraint. So it's editable here too, with the one real risk
// (orphaning a product's own batch history from the UI that shows it)
// guarded in the service instead of blocked outright — see
// StockService.updateProduct's own comment.
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isLotTracked?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  @IsOptional()
  @IsString()
  barcode?: string;
}
