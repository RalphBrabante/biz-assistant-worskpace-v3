import { Injectable } from '@nestjs/common';
import { OrdersRepository } from '../repositories/orders.repository';

@Injectable()
export class OrdersService {
  constructor(private readonly repository: OrdersRepository) {}

  health() {
    return {
      module: 'orders',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
