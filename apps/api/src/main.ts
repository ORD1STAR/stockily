import helmet from 'helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app/app.module';
import { AllExceptionsFilter } from './app/all-exceptions.filter';
import { frenchValidationExceptionFactory } from './app/validation-messages';
import { isLocalMode, localEnv } from './local/local-env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix, { exclude: ['health'] });
  app.use(helmet());

  // CORS_ORIGIN: comma-separated allowlist (e.g. "https://app.stockily.dz").
  // Wide-open enableCors() was fine for local dev only — a real deployment
  // must restrict this, since every endpoint sits behind cookie-less
  // Bearer auth but the browser will still happily send cross-origin
  // requests to it otherwise. Falls back to the Vite dev server's own
  // origin so local dev keeps working without setting anything.
  const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean) ?? ['http://localhost:4200'];
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Desktop app: the API also serves the web app on the same origin, so the
  // built frontend just calls /api — whatever port the shell picked.
  const webDir = localEnv().webDir;
  if (isLocalMode() && webDir) {
    app.useStaticAssets(webDir, { index: false });
    app.use((req: { method: string; path: string }, res: { sendFile(p: string): void }, next: () => void) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && req.path !== '/health') return res.sendFile(join(webDir, 'index.html'));
      next();
    });
  }

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not declared on the DTO
      forbidNonWhitelisted: true, // reject requests carrying unexpected fields, rather than silently dropping them
      transform: true, // so e.g. class-validator sees a real Date/number, not the raw string body
      exceptionFactory: frenchValidationExceptionFactory, // class-validator's own messages are English — the frontend shows body.message verbatim
    }),
  );
  const port = process.env.PORT || 3000;
  // A desktop device's API is for that machine only — never reachable from the shop's network.
  if (isLocalMode()) await app.listen(port, '127.0.0.1');
  else await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
