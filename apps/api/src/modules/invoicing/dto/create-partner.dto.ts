import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

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

  // Previously required (Action Plan §9 decision #9/§3) — made optional per
  // explicit user decision: a Partner can be created before its NIF is on
  // file. See schema.prisma's Partner.nif comment and invoicing.service.ts's
  // finalizeInvoice for the rest of this decision's consequences.
  @IsOptional()
  @IsString()
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

  // Milestone 10 — default payment terms in days (30/60/90...), used to
  // compute Invoice.dueDate. Nullable/optional: most partners have none on
  // file, no due-date tracking for them.
  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermsNetDays?: number;
}
