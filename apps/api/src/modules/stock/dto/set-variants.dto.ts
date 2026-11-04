import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/** Tailles / couleurs of a product. An empty list disables that axis. */
export class SetVariantsDto {
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  sizes!: string[];

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  colors!: string[];
}
