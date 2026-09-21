import { All, Controller, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { proxyLegacyRoute } from '../../legacy/legacy-route-proxy';

@Controller('api/v1/sales-invoices')
export class SalesInvoicesController {
  @All()
  async proxyRoot(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('sales-invoices', req, res, next);
  }

  @All(':path(.*)')
  async proxyNested(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('sales-invoices', req, res, next);
  }
}
