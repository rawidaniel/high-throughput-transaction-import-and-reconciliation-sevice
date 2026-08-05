import { ApiProperty } from '@nestjs/swagger';

export class LivenessDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({
    description: 'Seconds since this process started.',
    example: 3600,
  })
  uptimeSeconds!: number;
}

export class ReadinessChecksDto {
  @ApiProperty({ enum: ['ok', 'unreachable'], example: 'ok' })
  database!: string;
}

export class QueueDepthDto {
  @ApiProperty({
    description: 'Jobs waiting to be claimed by a worker.',
    example: 2,
  })
  pending!: number;

  @ApiProperty({
    description: 'Jobs currently leased by a worker.',
    example: 1,
  })
  claimed!: number;
}

export class ReadinessDto {
  @ApiProperty({
    enum: ['ready', 'not_ready', 'shutting_down'],
    example: 'ready',
  })
  status!: string;

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;

  @ApiProperty({ type: QueueDepthDto })
  queue!: QueueDepthDto;
}

export class EventLoopDto {
  @ApiProperty({ example: 0.42 })
  delayMeanMs!: number;

  @ApiProperty({ example: 0.31 })
  delayP50Ms!: number;

  @ApiProperty({
    description:
      'The number that demonstrates worker-thread isolation. Should stay in ' +
      'low single digits even while a large import is being scored.',
    example: 2.15,
  })
  delayP99Ms!: number;

  @ApiProperty({ example: 8.7 })
  delayMaxMs!: number;

  @ApiProperty({
    description: '0–1. Fraction of time the loop was busy rather than idle.',
    example: 0.0312,
  })
  utilization!: number;
}
