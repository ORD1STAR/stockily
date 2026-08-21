import { IsEmail, IsOptional, IsString } from 'class-validator';

// Backs the wireframe's "⚙ Paramètres du Business" screen (docs/Wireframes.html)
// — the org's own legal identity, required on Organization before a
// CUSTOMER invoice can be finalized (Décret 05-468's 12 mandatory
// mentions). Lives under Invoicing (apps/api/src/modules/invoicing) since
// Invoicing is the only current consumer/enforcer of this data — no
// separate "organization settings" module exists yet.
export class UpdateOrganizationProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

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
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
