import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsString, Min, ValidateNested } from 'class-validator';

export class RfqLinePriceDto {
  @IsString()
  lineId!: string;

  @IsNumber()
  @Min(0)
  unitCost!: number;
}

// A candidate RFQ line is created with unitCost: 0 (see
// PurchasingService.createRfq) — the buyer fills in each supplier's actual
// quoted price here once received, before comparing. Only touches lines
// belonging to a still-"rfq" purchase order — the moment one candidate is
// awarded/rejected, prices are frozen (same rationale as
// PurchasingService.updatePurchaseOrder refusing to touch a received one).
export class UpdateRfqPricesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RfqLinePriceDto)
  lines!: RfqLinePriceDto[];
}
