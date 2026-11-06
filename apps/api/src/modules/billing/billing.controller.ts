import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, RawBodyRequest, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { ChangePasswordDto, PurchaseDto, TwoFactorDto, UpdateAccountDto } from './billing.dto';
import { BillingService } from './billing.service';
import { ChargilyService } from './chargily.service';

// Public catalogue for the marketing site's Tarifs page — no auth.
@Controller('billing')
export class BillingCatalogController {
  constructor(private readonly billing: BillingService) {}

  @Get('catalog')
  catalog() {
    return this.billing.catalog();
  }
}

// Chargily Pay webhook: public, authenticated by the HMAC signature of the raw body.
@Controller('billing/webhook')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService, private readonly chargily: ChargilyService) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('signature') signature: string | undefined, @Body() event: Record<string, unknown>) {
    if (!this.chargily.verifySignature(req.rawBody, signature)) throw new UnauthorizedException('Signature invalide.');
    await this.billing.handleWebhook(event);
    return {};
  }
}

// The org's own subscription (Espace client). Not module-gated: an org
// whose every module lapsed must still be able to renew. Spending actions
// are restricted to org administrators inside the service.
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('me')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.overview(user.orgId, user.userId);
  }

  // Read-only preview of a purchase (same computation as the real one).
  @Post('quote')
  quote(@CurrentUser() user: AuthenticatedUser, @Body() dto: PurchaseDto) {
    return this.billing.quote(user.orgId, dto);
  }

  @Post('purchase')
  purchase(@CurrentUser() user: AuthenticatedUser, @Body() dto: PurchaseDto) {
    return this.billing.purchase(user.orgId, user.userId, dto);
  }

  // Back from Chargily: confirm the outcome with Chargily itself (the webhook may not have arrived yet).
  @Post('payments/:id/sync')
  sync(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.syncPayment(user.orgId, id);
  }

  @Get('payments/:id/pdf')
  async paymentPdf(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { pdf, number } = await this.billing.paymentPdf(user.orgId, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="facture-${number}.pdf"` });
    res.send(pdf);
  }
}

// The logged-in user's own profile (Espace client > Mon compte).
@Controller('account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.getAccount(user.userId);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAccountDto) {
    return this.billing.updateAccount(user.userId, dto);
  }

  @Post('two-factor')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setTwoFactor(@CurrentUser() user: AuthenticatedUser, @Body() dto: TwoFactorDto) {
    return this.billing.setTwoFactor(user.userId, dto.enabled, dto.password);
  }

  @Post('password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.billing.changePassword(user.userId, dto);
  }
}
