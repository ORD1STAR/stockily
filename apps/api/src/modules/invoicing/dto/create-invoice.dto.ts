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

  // Milestone 10 — set only by SalesService.invoiceSalesOrder, never by a
  // manual/direct invoice creation (Invoicing's own page, Vente rapide).
  // Read by finalizeInvoice to release the matching stock reservation and
  // advance SalesOrderLine.quantityInvoiced — purely additive.
  @IsOptional()
  @IsString()
  salesOrderLineId?: string;
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

  // Milestone 9 field, never actually wired into this DTO until now —
  // optional traceability link from a SUPPLIER invoice to the purchase
  // order it's settling (Achats' "créer facture fournisseur" action sets
  // this). Purely additive, nothing conditioned on it.
  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  // Milestone 10 — optional traceability link from a CUSTOMER invoice to
  // the commande (SalesOrder) it (partially) fulfills. Set by
  // SalesService.invoiceSalesOrder, never by a manual/direct invoice.
  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineDto)
  lines!: CreateInvoiceLineDto[];
}
