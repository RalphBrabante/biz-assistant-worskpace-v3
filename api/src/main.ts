import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LegacyApiService } from './modules/legacy/services/legacy-api.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  const legacyApi = app.get(LegacyApiService);
  legacyApi.setup(app);

  const port = Number(process.env.PORT || 3000);
  await app.init();

  const httpServer = app.getHttpServer();
  await legacyApi.initializeInfrastructure(httpServer);

  const server = httpServer.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });

  server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS || 5000);
  server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 6000);
  server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 30000);

  const shutdown = async () => {
    await legacyApi.shutdown();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Nest bootstrap failed:', err);
  process.exit(1);
});
