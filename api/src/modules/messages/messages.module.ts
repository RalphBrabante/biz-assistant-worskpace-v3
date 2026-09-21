import { Module } from '@nestjs/common';
import { MessagesController } from './controllers/messages.controller';
import { MessagesService } from './services/messages.service';
import { MessagesRepository } from './repositories/messages.repository';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService, MessagesRepository],
  exports: [MessagesService, MessagesRepository],
})
export class MessagesModule {}
