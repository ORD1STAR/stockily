import { Module } from '@nestjs/common';
import { ReleasesController } from './releases.controller';
import { ReleasesService } from './releases.service';

// Server-only: a desktop device never serves installers.
@Module({ controllers: [ReleasesController], providers: [ReleasesService] })
export class ReleasesModule {}
