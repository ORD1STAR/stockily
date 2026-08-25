import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreatePaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  method?: string;
}
