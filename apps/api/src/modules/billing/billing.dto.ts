import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class PurchaseDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Sélectionnez au moins un module.' })
  @ArrayMaxSize(20)
  @IsString({ each: true })
  modules!: string[];

  @IsIn([1, 3, 6, 12], { message: 'Durée invalide.' })
  months!: number;

  @IsOptional()
  @IsString()
  packKey?: string;

  /** Multi-sites: how many sites beyond the first (free for life) to pay for. Default: the current quota, else 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  extraSites?: number;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsEmail({}, { message: 'Adresse email invalide.' })
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @Matches(/^[a-zA-Z0-9._-]{3,40}$/, { message: "Le nom d'utilisateur doit faire 3 à 40 caractères (lettres, chiffres, . _ -)." })
  username?: string;

  @IsOptional()
  @Matches(/^[+0-9 ().-]{6,25}$/, { message: 'Numéro de téléphone invalide.' })
  phone?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' })
  @MaxLength(128)
  newPassword!: string;
}

export class TwoFactorDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;
}
