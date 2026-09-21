import { Injectable } from '@nestjs/common';
import { ItemsRepository } from '../repositories/items.repository';

@Injectable()
export class ItemsService {
  constructor(private readonly repository: ItemsRepository) {}

  health() {
    return {
      module: 'items',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
