import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersRepository {
  name(): string {
    return 'orders';
  }
}
