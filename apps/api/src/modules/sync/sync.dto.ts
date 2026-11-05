import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEVICE_COUNTER_KEYS } from './snapshot-models';

export class DeviceSessionDto {
  @IsString()
  userId!: string;
}

export class ReserveBlockDto {
  @IsIn(DEVICE_COUNTER_KEYS)
  counterKey!: (typeof DEVICE_COUNTER_KEYS)[number];

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(500)
  size?: number;
}
