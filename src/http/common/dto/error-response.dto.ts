import { ApiProperty } from '@nestjs/swagger';

export class ErrorDetailDto {
  @ApiProperty({
    description: 'Stable, machine-readable error code. Safe to branch on.',
    example: 'MISSING_IDEMPOTENCY_KEY',
  })
  code!: string;

  @ApiProperty({
    description:
      'Human-readable message safe to display. Never contains stack traces, SQL, internal paths, or raw exception details.',
    example: 'Idempotency-Key header is required.',
  })
  message!: string;

  @ApiProperty({
    description:
      'Correlation id for this request. Include it when reporting an issue.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  requestId!: string;
}

export class ErrorResponseDto {
  @ApiProperty({ type: ErrorDetailDto })
  error!: ErrorDetailDto;
}
