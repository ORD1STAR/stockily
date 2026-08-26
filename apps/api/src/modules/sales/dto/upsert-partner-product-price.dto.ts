import { IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

// Exactly one of unitPrice/discountPercent is expected — a fixed negotiated
// price, or a negotiated discount off the product's own Product.sellPrice.
// Not enforced as a hard either/or here (class-validator can't express that
// cleanly across two optional fields, same situation as
// RecordQualityCheckDto) — SalesService.resolveLinePrices already prefers
// unitPrice when both happen to be set, so nothing breaks either way.
export class UpsertPartnerProductPriceDto {
  @IsString()
  partnerId!: string;

  @IsString()
  productId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ValidateIf((o) => o.unitPrice == null)
  discountPercent?: number;
}
