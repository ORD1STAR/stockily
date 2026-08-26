import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength, ValidateNested } from 'class-validator';

// Achats' own convenience wrapper around Invoicing's existing
// POST /invoicing/invoices (type: SUPPLIER) — same underlying call,
// gated by purchasing.invoice.create only, so a warehouse/purchasing role
// doesn't need any invoicing.* permission of its own to record what a
// supplier billed for a given BC (same pattern as receiving not needing
// stock.* permissions).
export class CreateSupplierInvoiceLineDto {
  @IsOptional()
  @IsString()
  productId?: string;

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
  @IsString()
  taxRateId?: string;
}

export class CreateSupplierInvoiceDto {
  @IsString()
  @MinLength(1)
  number!: string; // the supplier's own reference — never auto-assigned

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierInvoiceLineDto)
  lines!: CreateSupplierInvoiceLineDto[];
}
