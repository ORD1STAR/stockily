import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  identifier!: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class SetModuleDto {
  @IsIn(['activate', 'suspend', 'cancel'])
  action!: 'activate' | 'suspend' | 'cancel';

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class SetSeatsDto {
  @IsInt()
  @Min(1)
  @Max(50)
  seatsPerSite!: number;
}

export class SetDeviceDto {
  @IsIn(['deactivate', 'revoke'])
  action!: 'deactivate' | 'revoke';
}

export class SetPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyPrice!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RunSqlDto {
  @IsString()
  @MaxLength(20000)
  sql!: string;

  @IsOptional()
  @IsBoolean()
  write?: boolean;

  // Must equal the exact phrase the UI shows for a write ("JE CONFIRME").
  @IsOptional()
  @IsString()
  confirm?: string;
}

// Platform-admin account edit: any user (owners included), no password policy.
export class AdminUpdateUserDto {
  @IsOptional() @IsString() @MaxLength(120)
  displayName?: string;

  @IsOptional() @IsString() @MaxLength(60)
  username?: string;

  @IsOptional() @IsString() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(200)
  password?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
