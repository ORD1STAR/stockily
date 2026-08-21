import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isCustomer?: boolean;

  @IsOptional()
  @IsBoolean()
  isSupplier?: boolean;

  // Required — every Partner record represents a formal business
  // relationship with a real NIF (Action Plan §9 decision #9/§3); a
  // customer with no NIF is modeled as no Partner at all (partnerId: null
  // on the invoice, "vente comptoir"), not a Partner with an empty NIF.
  @IsString()
  @MinLength(1)
  nif!: string;

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
}
