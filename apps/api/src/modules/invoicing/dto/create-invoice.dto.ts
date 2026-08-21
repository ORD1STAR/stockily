import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CreateInvoiceLineDto {
  @IsOptional()
  @IsString()
  productId?: string; // null/absent -> services-only line, no Stock module involvement (Action Plan §9)

  @IsString()
  @MinLength(1)
  description!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsString()
  taxRateId?: string;
}

export class CreateInvoiceDto {
  @IsEnum(['CUSTOMER', 'SUPPLIER'])
  type!: 'CUSTOMER' | 'SUPPLIER';

  @IsString()
  siteId!: string;

  @IsOptional()
  @IsString()
  partnerId?: string; // absent = walk-in / "vente comptoir" for a CUSTOMER invoice (confirmed override path)

  // Required for SUPPLIER (the supplier's own reference — never auto-assigned
  // by us, see schema.prisma's Invoice comment); must be ABSENT for CUSTOMER,
  // whose number is only assigned at finalization.
  @ValidateIf((o) => o.type === 'SUPPLIER')
  @IsString()
  @MinLength(1)
  number?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineDto)
  lines!: CreateInvoiceLineDto[];
}
