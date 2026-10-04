import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { AppModule } from './app.module';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: config().NODE_ENV === 'test' ? (process.env.E2E_LOG ? ['error'] : false) : undefined, bodyParser: false });
  // backups from the old app can be several MB
  app.useBodyParser('json', { limit: '25mb' });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config().WEB_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}
