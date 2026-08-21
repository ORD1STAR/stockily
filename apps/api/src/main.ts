import helmet from 'helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { AllExceptionsFilter } from './app/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not declared on the DTO
      forbidNonWhitelisted: true, // reject requests carrying unexpected fields, rather than silently dropping them
      transform: true, // so e.g. class-validator sees a real Date/number, not the raw string body
    }),
  );
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
