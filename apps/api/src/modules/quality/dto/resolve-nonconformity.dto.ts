import { IsOptional, IsString } from 'class-validator';

export class ResolveNonConformityDto {
  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
