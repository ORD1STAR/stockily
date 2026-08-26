import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsPositive, IsString, ValidateNested } from 'class-validator';

export class RfqProductLineDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;
}

// Creates N candidate PurchaseOrder rows (one per invited supplier, status
// "rfq"), all sharing one comparisonGroupId, so the frontend can render a
// side-by-side price comparison for the same product lines across
// suppliers before awarding one — see PurchasingService.createRfq.
export class CreateRfqDto {
  @IsString()
  siteId!: string;

  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  supplierIds!: string[]; // at least 2 — a "comparison" of one supplier isn't a comparison

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RfqProductLineDto)
  productLines!: RfqProductLineDto[];
}
