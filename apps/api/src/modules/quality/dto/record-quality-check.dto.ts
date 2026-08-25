import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// Two valid shapes (see @org/domain-quality's RecordQualityCheckInput doc
// comment): batch-based (batchId set) or product-direct (siteId+quantity
// set) — never both, never neither. class-validator can't express an
// either/or constraint cleanly across these three optional fields, so this
// DTO only validates each field's own shape; QualityService (domain) is
// what actually enforces "exactly one path" and throws
// InvalidQualityCheckInputError otherwise — not duplicated here.
export class RecordQualityCheckDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantity?: number;

  @IsIn(['conforme', 'non_conforme'])
  result!: 'conforme' | 'non_conforme';

  @IsOptional()
  @IsString()
  notes?: string;
}
