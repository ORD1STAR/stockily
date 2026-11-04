import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min, ValidateIf, ValidateNested } from 'class-validator';

export const REMINDER_FREQUENCIES = ['off', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'] as const;
export type ReminderFrequency = (typeof REMINDER_FREQUENCIES)[number];

export class CreateInventoryCountDto {
  @IsString()
  siteId!: string;

  /** all = every product; category = one famille; selection = the given products. */
  @IsIn(['all', 'category', 'selection'])
  scope!: 'all' | 'category' | 'selection';

  @ValidateIf((o) => o.scope === 'category')
  @IsString()
  categoryId?: string;

  @ValidateIf((o) => o.scope === 'selection')
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CountedLineDto {
  @IsString()
  productId!: string;

  /** null clears the count (line back to "not counted"). */
  @ValidateIf((o) => o.countedQty !== null)
  @IsNumber()
  @Min(0)
  countedQty!: number | null;
}

export class UpdateCountedLinesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CountedLineDto)
  lines!: CountedLineDto[];
}

export class ValidateInventoryDto {
  /** Products left uncounted are set to 0 (otherwise they're left unchanged). */
  @IsOptional()
  @IsBoolean()
  zeroUncounted?: boolean;
}

export class InventorySettingsDto {
  @IsIn(REMINDER_FREQUENCIES)
  inventoryReminder!: ReminderFrequency;
}
