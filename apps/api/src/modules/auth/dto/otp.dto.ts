import { IsString, IsUUID, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Matches(/^\s*\d{6}\s*$/, { message: 'Le code comporte 6 chiffres.' })
  code!: string;
}

export class ResendOtpDto {
  @IsUUID()
  challengeId!: string;
}
