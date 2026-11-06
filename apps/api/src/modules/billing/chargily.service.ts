import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ChargilyCheckout {
  id: string;
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'canceled' | string;
  amount: number;
  checkout_url?: string;
  customer_id?: string | null;
  invoice_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Thin client for Chargily Pay v2 (https://dev.chargily.com/pay-v2). Only
// customers and checkouts are used: no products, no prices. The secret key
// decides the mode: `test_sk_...` talks to the test API (no real money),
// `live_sk_...` to the live one. Unset = payments are "offered" (launch mode).
@Injectable()
export class ChargilyService {
  private readonly logger = new Logger(ChargilyService.name);

  private key(): string | undefined {
    return process.env.CHARGILY_SECRET_KEY?.trim() || undefined;
  }

  enabled(): boolean {
    return !!this.key();
  }

  private base(): string {
    if (process.env.CHARGILY_API_URL) return process.env.CHARGILY_API_URL.replace(/\/$/, '');
    return this.key()?.startsWith('live_') ? 'https://pay.chargily.net/api/v2' : 'https://pay.chargily.net/test/api/v2';
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const key = this.key();
    if (!key) throw new BadGatewayException('Le paiement en ligne n’est pas configuré.');
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.error(`Chargily ${method} ${path} unreachable: ${(err as Error).message}`);
      throw new BadGatewayException('Le service de paiement est injoignable. Réessayez dans un instant.');
    }
    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`Chargily ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      throw new BadGatewayException('Le service de paiement a refusé la demande. Réessayez ou contactez le support.');
    }
    return JSON.parse(text) as T;
  }

  /** `metadata.stockily_org_id` is our database id: the link back to the org. */
  createCustomer(input: { name: string; email?: string | null; phone?: string | null; orgId: string }): Promise<{ id: string }> {
    return this.call('POST', '/customers', {
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      metadata: { stockily_org_id: input.orgId },
    });
  }

  createCheckout(input: {
    amount: number;
    customerId: string;
    description: string;
    successUrl: string;
    failureUrl: string;
    webhookUrl: string;
    metadata: Record<string, string>;
  }): Promise<ChargilyCheckout> {
    return this.call('POST', '/checkouts', {
      amount: input.amount,
      currency: 'dzd',
      customer_id: input.customerId,
      description: input.description,
      success_url: input.successUrl,
      failure_url: input.failureUrl,
      webhook_endpoint: input.webhookUrl,
      locale: 'fr',
      metadata: input.metadata,
    });
  }

  getCheckout(id: string): Promise<ChargilyCheckout> {
    return this.call('GET', `/checkouts/${encodeURIComponent(id)}`);
  }

  /** The `signature` header is the HMAC-SHA256 (hex) of the RAW body with the secret key. */
  verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    const key = this.key();
    if (!key || !rawBody || !signature) return false;
    const expected = createHmac('sha256', key).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
