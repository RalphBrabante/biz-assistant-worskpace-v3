import { Injectable } from '@nestjs/common';

@Injectable()
export class ItemsRepository {
  name(): string {
    return 'items';
  }
}
