import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

// Mirrors CreatePartnerDto but every field is optional — a partial update
// (e.g. fixing a phone number) shouldn't have to resend the whole record.
export class UpdatePartnerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isCustomer?: boolean;

  @IsOptional()
  @IsBoolean()
  isSupplier?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nif?: string;

  @IsOptional()
  @IsString()
  nis?: string;

  @IsOptional()
  @IsString()
  rc?: string;

  @IsOptional()
  @IsString()
  taxArticle?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermsNetDays?: number;
}
