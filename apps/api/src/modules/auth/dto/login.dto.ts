import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

// Login accepts an email OR a username. `identifier` is the new field the
// web sends ("Email ou nom d'utilisateur"); `email` is kept so any older
// client (or the desktop shell's one-time activation login) keeps working.
// Exactly one is required — AuthService resolves whichever is present
// against both the email and username columns.
export class LoginDto {
  @ValidateIf((o: LoginDto) => !o.email)
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  identifier?: string;

  @ValidateIf((o: LoginDto) => !o.identifier)
  @IsString()
  @MaxLength(320)
  email?: string;

  @IsString()
  password!: string;
}
