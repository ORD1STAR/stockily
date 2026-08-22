import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Deliberately narrower than CreateProductDto — sku, categoryId,
// unitOfMeasure and isLotTracked are structural (isLotTracked in
// particular has cascading implications once batches exist against a
// product) and aren't editable here, just the day-to-day fields a
// manager actually needs to correct: the name, its thresholds, and its
// default sale price.
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

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
}
