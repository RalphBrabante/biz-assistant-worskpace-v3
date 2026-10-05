import { Controller, Get, Module, Post, Req, Res } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingRepository } from './pricing.repository';
import { pricingRequestIp } from './pricing-request-ip';
const { authenticateRequest } = require('../../middleware/authz');

@Controller('api/v1/pricing')
export class PricingController {
  constructor(private readonly service: PricingService, private readonly repository: PricingRepository) {}
  @Get('catalogue')
  catalogue(@Res() res: any) {
    res.set('Cache-Control', 'no-store');
    return res.json({ data: this.service.catalogue() });
  }
  @Post('requests')
  async request(@Req() req: any, @Res() res: any) {
    res.set('Cache-Control', 'no-store');
    try {
      const result = await this.service.submit(req.body, pricingRequestIp(req));
      return res.status(201).json(result);
    } catch (error) {
      const status = error.getStatus?.() || 503;
      if (status === 429) res.set('Retry-After', '3600');
      return res.status(status).json({ message: status < 500 ? error.message : 'Plan requests are temporarily unavailable. Your information has not been cleared; please try again.' });
    }
  }
  @Get('requests')
  async list(@Req() req: any, @Res() res: any) {
    res.set('Cache-Control', 'no-store');
    await new Promise<void>((resolve, reject) => {
      const done = (error?: any) => { res.off('finish', finish); res.off('close', finish); error ? reject(error) : resolve(); };
      const finish = () => done();
      res.once('finish', finish); res.once('close', finish);
      Promise.resolve(authenticateRequest(req, res, done)).catch(done);
    });
    if (res.headersSent) return;
    if (!req.auth?.roleCodes?.includes('superuser')) return res.status(403).json({ message: 'Only authorized platform staff can review plan requests.' });
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 1000) return res.status(400).json({ message: 'Invalid page.' });
    const result = await this.repository.list(page);
    return res.json({ data: result.rows, meta: { page, total: result.count, limit: 50 } });
  }
}
@Module({ controllers: [PricingController], providers: [PricingService, PricingRepository] })
export class PricingModule {}
