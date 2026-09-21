import { Injectable } from '@nestjs/common';

@Injectable()
export class MessagesRepository {
  name(): string {
    return 'messages';
  }
}
