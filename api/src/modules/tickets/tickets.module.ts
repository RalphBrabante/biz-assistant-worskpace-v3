import { All, Controller, Module, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { proxyLegacyRoute } from '../legacy/legacy-route-proxy';
@Controller('api/v1/tickets')
class TicketsController {
  @All(['', '*'])
  handle(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('tickets', req, res, next);
  }
}
@Module({controllers: [TicketsController]})
export class TicketsModule {}
