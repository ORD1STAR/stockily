import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateTransferDto {
  @IsOptional()
  @IsIn(['prepared', 'in_transit', 'delivered'])
  status?: 'prepared' | 'in_transit' | 'delivered';

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  vehicleRef?: string;
}
