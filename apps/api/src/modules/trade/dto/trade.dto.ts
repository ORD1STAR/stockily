import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const TRADE_DOCUMENT_TYPES = ['delivery_note', 'customer_return', 'supplier_return'] as const;
export type TradeDocumentType = (typeof TRADE_DOCUMENT_TYPES)[number];

export class TradeDocumentLineDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  /** HT. Omitted = the product's price for this partner (tier price, or average cost for a supplier return). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  taxRateId?: string;

  /** BL issued from a commande: the commande line being delivered. */
  @IsOptional()
  @IsString()
  salesOrderLineId?: string;
}

export class DocumentPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsIn(['especes', 'cheque', 'virement', 'autre'])
  method?: string;
}

export class CreateTradeDocumentDto {
  @IsIn(TRADE_DOCUMENT_TYPES)
  type!: TradeDocumentType;

  @IsString()
  siteId!: string;

  /** Optional for a BL / retour client (client comptoir), required for a retour fournisseur. */
  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Versement made with the bon (or refund, for a retour). */
  @IsOptional()
  @ValidateNested()
  @Type(() => DocumentPaymentDto)
  payment?: DocumentPaymentDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TradeDocumentLineDto)
  lines!: TradeDocumentLineDto[];
}

export class InvoiceDocumentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  documentIds!: string[];
}

export class CreatePartnerPaymentDto {
  @IsString()
  partnerId!: string;

  /** in = we receive money (client pays), out = we pay (fournisseur). */
  @IsIn(['in', 'out'])
  direction!: 'in' | 'out';

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsIn(['especes', 'cheque', 'virement', 'autre'])
  method?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  /** Attach the versement to an existing bon (BL / BR / retour). */
  @IsOptional()
  @IsIn(['delivery_note', 'customer_return', 'supplier_return', 'purchase_receipt'])
  documentType?: string;

  @IsOptional()
  @IsString()
  documentId?: string;
}
