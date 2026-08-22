import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

// Single unit of measure per product, no variant model (§9 decisions #2/#4)
// — deliberately no `unit conversion` or `variantOf` fields here.
export class CreateProductDto {
  @IsString()
  sku!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  unitOfMeasure?: string;

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
}
