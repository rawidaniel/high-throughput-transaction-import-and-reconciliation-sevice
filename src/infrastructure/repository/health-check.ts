import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthCheckPort } from '../../application/ports/health-check.port';

@Injectable()
export class HealthCheck implements HealthCheckPort {
  constructor(private readonly prisma: PrismaService) {}

  async pingDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async getQueueDepth(): Promise<{ pending: number; claimed: number }> {
    const [pending, claimed] = await Promise.all([
      this.prisma.processingJob.count({ where: { status: 'PENDING' } }),
      this.prisma.processingJob.count({ where: { status: 'CLAIMED' } }),
    ]);
    return { pending, claimed };
  }
}
