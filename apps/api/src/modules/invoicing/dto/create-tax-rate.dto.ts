import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateTaxRateDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  rate!: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
