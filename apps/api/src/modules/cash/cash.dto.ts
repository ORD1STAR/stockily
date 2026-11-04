import { IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export const CASH_METHODS = ['especes', 'carte', 'cheque', 'virement', 'autre'] as const;

export class CreateCashEntryDto {
  /** in = encaissement, out = décaissement. */
  @IsIn(['in', 'out'])
  direction!: 'in' | 'out';

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsIn(CASH_METHODS)
  method?: string;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  /** A BL (encaissement) or a bon de réception (décaissement) of the partner: recorded as a versement on that bon. */
  @IsOptional()
  @IsString()
  documentId?: string;

  @IsOptional()
  @IsIn(['delivery_note', 'purchase_receipt'])
  documentType?: 'delivery_note' | 'purchase_receipt';

  /** Without a bon: count the amount on the partner's account (versement client / paiement fournisseur). */
  @IsOptional()
  @IsBoolean()
  applyToBalance?: boolean;
}
