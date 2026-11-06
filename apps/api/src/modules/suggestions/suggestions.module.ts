import { Module } from '@nestjs/common';
import { AdminModule } from '../../admin/admin.module';
import { SuggestionsController } from './suggestions.controller';

// Server-only (like AdminModule, whose superuser client it reuses).
@Module({ imports: [AdminModule], controllers: [SuggestionsController] })
export class SuggestionsModule {}
