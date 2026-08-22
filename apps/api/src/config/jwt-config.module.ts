import { Global, Logger, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

const logger = new Logger('JwtConfigModule');

const INSECURE_DEV_SECRET = 'dev-insecure-secret-change-me';

function resolveSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    // Fail loudly rather than silently signing production tokens with a
    // well-known default — this is exactly the kind of silent trust/config
    // issue flagged elsewhere in this project's history (an auto-generated
    // .claude/settings.json that quietly loosened permissions); don't repeat
    // the pattern here with a JWT secret.
    throw new Error('JWT_SECRET must be set in production');
  }
  logger.warn(`JWT_SECRET not set — using an insecure default for local development only.`);
  return INSECURE_DEV_SECRET;
}

// Global: both AuthModule (signs access tokens) and TenancyModule's
// JwtAuthGuard (verifies them) need JwtService. Configuring it once here
// avoids either module owning the config or a circular import between them.
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: resolveSecret(),
      // JWT_ACCESS_TTL is an env var (plain `string`), but @nestjs/jwt's
      // expiresIn wants `ms`'s StringValue — a huge template-literal union
      // ("15m", "1h", "7 days"...) that TS can't verify an arbitrary string
      // satisfies at compile time. The cast is the actual contract here:
      // whatever's configured must already be one of those forms, the same
      // trust boundary as any other env-driven config value.
      signOptions: { expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as StringValue },
    }),
  ],
  exports: [JwtModule],
})
export class JwtConfigModule {}
