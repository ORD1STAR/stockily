import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class ModuleAccessDto {
  @IsString()
  key!: string;

  @IsIn(['view', 'edit', 'custom'])
  level!: 'view' | 'edit' | 'custom';

  // Only for level 'custom': the explicit capabilities' actions.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];
}

export class AccessDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModuleAccessDto)
  modules!: ModuleAccessDto[];

  // 'all' = every site (org-wide role); otherwise the explicit site ids this
  // member may touch.
  @IsOptional()
  sites?: 'all' | string[];
}

export class CreateMemberDto {
  // Login handle. Letters/digits/._- , no spaces, so it can't be confused
  // with an email and stays easy to type on a shop keyboard.
  @Matches(/^[a-zA-Z0-9._-]{3,40}$/, { message: "Le nom d'utilisateur doit faire 3 à 40 caractères (lettres, chiffres, . _ -)." })
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsString()
  @MinLength(6, { message: 'Le mot de passe doit faire au moins 6 caractères.' })
  @MaxLength(200)
  password!: string;

  @ValidateNested()
  @Type(() => AccessDto)
  access!: AccessDto;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AccessDto)
  access?: AccessDto;
}
