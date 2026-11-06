import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminPrismaService } from '../../admin/admin-prisma.service';
import { CreateSuggestionDto } from './suggestions.dto';

// Public "Proposer des ajouts" form on the marketing site. No account needed,
// so it is rate limited hard (5 per 10 minutes per IP) and has a honeypot.
@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly db: AdminPrismaService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async create(@Body() dto: CreateSuggestionDto) {
    // A bot filled the hidden field: pretend it worked, store nothing.
    if (dto.website) return { ok: true };
    const clean = (v?: string) => (v?.trim() ? v.trim() : null);
    await this.db.featureSuggestion.create({
      data: {
        email: dto.email.trim().toLowerCase(),
        name: clean(dto.name),
        activity: dto.activity ?? null,
        area: dto.area ?? null,
        need: dto.need.trim(),
        priority: dto.priority ?? null,
        currentTool: clean(dto.currentTool),
      },
    });
    return { ok: true };
  }
}
