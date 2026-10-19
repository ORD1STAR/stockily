import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Deliberately narrower than CreateProductDto — sku and unitOfMeasure are
// genuinely structural, not editable here. categoryId used to be excluded
// on the same reasoning but the "Modifier" flow on the Stock product detail
// needs to let a product be reassigned to a different family, same as it
// already can be set at creation time — see StockService.updateProduct.
// isLotTracked
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
  @IsString()
  categoryId?: string;

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

  // Units per carton — optional, editable later; null clears it.
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerCarton?: number | null;
}
