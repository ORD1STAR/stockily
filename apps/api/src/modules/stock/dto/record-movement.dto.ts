import { IsEnum, IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class RecordMovementDto {
  @IsString()
  productId!: string;

  @IsString()
  siteId!: string;

  @IsEnum(['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT'])
  type!: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsNumber()
  unitCost?: number;

  @IsOptional()
  @IsString()
  toSiteId?: string;

  @IsOptional()
  @IsIn(['increase', 'decrease'])
  adjustmentDirection?: 'increase' | 'decrease';

  @IsOptional()
  @IsString()
  relatedEntityType?: string;

  @IsOptional()
  @IsString()
  relatedEntityId?: string;
}
