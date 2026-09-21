import { Module } from '@nestjs/common';
import { ItemsController } from './controllers/items.controller';
import { ItemsService } from './services/items.service';
import { ItemsRepository } from './repositories/items.repository';

@Module({
  controllers: [ItemsController],
  providers: [ItemsService, ItemsRepository],
  exports: [ItemsService, ItemsRepository],
})
export class ItemsModule {}
