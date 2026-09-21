import { Injectable } from '@nestjs/common';
import { MessagesRepository } from '../repositories/messages.repository';

@Injectable()
export class MessagesService {
  constructor(private readonly repository: MessagesRepository) {}

  health() {
    return {
      module: 'messages',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
