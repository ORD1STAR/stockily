import { IsHash, IsOptional, IsString, MaxLength } from 'class-validator';

// Hardware identifiers are hashed (sha256, hex) on the device before they
// are sent — the server never sees a raw motherboard UUID, disk serial or MAC.
export class DeviceFingerprintDto {
  @IsHash('sha256')
  motherboardHash!: string;

  @IsHash('sha256')
  diskHash!: string;

  @IsHash('sha256')
  macHash!: string;
}

export class ActivateDeviceDto extends DeviceFingerprintDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}

export class LicenseTokenDto extends DeviceFingerprintDto {
  @IsString()
  @MaxLength(4000)
  licenseToken!: string;
}
