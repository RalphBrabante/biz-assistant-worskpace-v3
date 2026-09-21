import { All, Controller, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { proxyLegacyRoute } from '../../legacy/legacy-route-proxy';

@Controller('api/v1/customers')
export class CustomersController {
  @All()
  async proxyRoot(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('customers', req, res, next);
  }

  @All(':path(.*)')
  async proxyNested(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('customers', req, res, next);
  }
}
