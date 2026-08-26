import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export class CreateSalesOrderLineDto {
  @IsOptional()
  @IsString()
  productId?: string; // absent -> services-only line, no reservation applies (same as InvoiceLine/PurchaseOrderLine's own nullable productId)

  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string; // required when productId is absent — validated in SalesService, not here (mirrors CreateInvoiceLineDto's own product-vs-description shape)

  @IsNumber()
  @IsPositive()
  quantity!: number;

  // Optional — when absent, SalesService resolves it from PartnerProductPrice
  // (negotiated customer pricing) then Product.sellPrice. Present = explicit
  // manual override, same convention as every price field elsewhere in this
  // codebase.
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  taxRateId?: string;
}

export class CreateSalesOrderDto {
  @IsIn(['quote', 'order'])
  kind!: 'quote' | 'order'; // devis vs commande — see schema.prisma's SalesOrder comment

  @IsString()
  siteId!: string; // fulfillment site — reservation is per (product, site)

  @IsString()
  customerId!: string; // a Partner with isCustomer = true

  @IsOptional()
  @IsISO8601()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // A "commande" (kind: 'order') that would exceed available (on-hand minus
  // already-reserved) stock on any product line is rejected with a 409
  // detailing the shortage UNLESS this is explicitly true — the frontend's
  // "aperçu puis confirmation" flow: first submit without this (or false),
  // show the 409's shortage to the user, resubmit with this set to true
  // once they've confirmed. Ignored for kind: 'quote' (a devis never
  // reserves anything, so there's nothing to be short on).
  @IsOptional()
  @IsBoolean()
  acknowledgeShortage?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines!: CreateSalesOrderLineDto[];
}
