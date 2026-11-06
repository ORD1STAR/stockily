import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const SUGGESTION_AREAS = ['stock', 'quality', 'scan', 'invoicing', 'sales', 'purchasing', 'cash', 'sites', 'stats', 'new_module', 'mobile', 'other'] as const;
export const SUGGESTION_PRIORITIES = ['must_have', 'useful', 'nice_to_have'] as const;
export const SUGGESTION_ACTIVITIES = ['retail', 'wholesale', 'distribution', 'production', 'services', 'other'] as const;

export class CreateSuggestionDto {
  @IsEmail({}, { message: 'Adresse email invalide.' })
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn([...SUGGESTION_ACTIVITIES])
  activity?: string;

  @IsOptional()
  @IsIn([...SUGGESTION_AREAS])
  area?: string;

  @IsString()
  @MinLength(10, { message: 'Décrivez votre besoin en quelques mots (10 caractères minimum).' })
  @MaxLength(3000, { message: 'Votre message est trop long (3000 caractères maximum).' })
  need!: string;

  @IsOptional()
  @IsIn([...SUGGESTION_PRIORITIES])
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentTool?: string;

  /** Honeypot: real visitors never fill this hidden field, bots do. */
  @IsOptional()
  @IsString()
  website?: string;
}

export class UpdateSuggestionDto {
  @IsOptional()
  @IsIn(['new', 'reviewing', 'planned', 'done', 'declined'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;
}
