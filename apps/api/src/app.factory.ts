import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { AppModule } from './app.module';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: config().NODE_ENV === 'test' ? false : undefined });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config().WEB_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}
