import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { webOrigin } from './core/origin';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.set('trust proxy', 1);
  app.enableCors({ origin: webOrigin(), credentials: true });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4010));
  console.log(`ANANDA API on :${process.env.PORT ?? 4010}`);
}
bootstrap();
