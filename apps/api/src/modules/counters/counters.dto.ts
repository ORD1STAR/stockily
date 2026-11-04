import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export const COUNTER_PAYMENT_METHODS = ['especes', 'carte', 'cheque'] as const;

export class CreateCounterDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  siteId!: string;
}

export class UpdateCounterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class OpenSessionDto {
  @IsNumber()
  @Min(0)
  openingCash!: number;
}

export class CloseSessionDto {
  /** Espèces réellement comptées dans la caisse. */
  @IsNumber()
  @Min(0)
  countedCash!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CashMovementDto {
  @IsIn(['in', 'out'])
  direction!: 'in' | 'out';

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  reason!: string;
}

export class CounterSaleLineDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  taxRateId?: string;
}

export class CounterSaleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CounterSaleLineDto)
  lines!: CounterSaleLineDto[];

  /** Client nommé (optionnel) — required for a sale on credit. */
  @IsOptional()
  @IsString()
  partnerId?: string;

  /** false = à crédit (client nommé obligatoire). */
  @IsBoolean()
  paid!: boolean;

  @IsOptional()
  @IsIn(COUNTER_PAYMENT_METHODS)
  paymentMethod?: (typeof COUNTER_PAYMENT_METHODS)[number];

  /** Montant remis par le client (espèces) — to compute the change. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountReceived?: number;
}
