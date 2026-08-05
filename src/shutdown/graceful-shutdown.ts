import { INestApplicationContext } from '@nestjs/common';
import { LoggerPort } from 'src/application/ports/logger.port';
import { ShutdownState } from '../application/shutdown/shutdown-state';

export interface ShutdownStep {
  name: string;
  run: () => Promise<void>;
}

export interface GracefulShutdownOptions {
  processName: string;
  graceMs: number;
  steps: ShutdownStep[];
  context: INestApplicationContext;
  logger: LoggerPort;
  shutdownState: ShutdownState;
}

export function registerGracefulShutdown(
  options: GracefulShutdownOptions,
): void {
  const { processName, graceMs, steps, context, logger, shutdownState } =
    options;
  let handling = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (handling) {
      logger.warn(
        `${processName}: second ${signal} received — exiting immediately`,
        {},
      );

      process.exit(1);
    }
    handling = true;

    shutdownState.begin();
    logger.info(
      `${processName}: ${signal} received, shutting down gracefully`,
      { graceMs },
    );

    let currentStep = 'starting';

    const forceExit = setTimeout(() => {
      logger.error(
        `${processName}: GRACE PERIOD EXCEEDED — forcing exit. ` +
          `Step "${currentStep}" did not complete within ${graceMs}ms. ` +
          `In-flight work may be incomplete; leases will be reclaimed on next worker start.`,
        { graceMs, stuckStep: currentStep },
      );
      process.exit(1);
    }, graceMs);

    // unref so this timer alone never keeps the process alive if everything
    // else finishes cleanly.
    forceExit.unref();

    try {
      for (const step of steps) {
        currentStep = step.name;
        const started = Date.now();
        await step.run();
        logger.info(`${processName}: shutdown step complete`, {
          step: step.name,
          durationMs: Date.now() - started,
        });
      }

      currentStep = 'nest-context-close';
      await context.close();

      clearTimeout(forceExit);
      logger.info(`${processName}: shutdown complete`, {
        totalMs: shutdownState.elapsedMs,
      });
      process.exit(0);
    } catch (err) {
      clearTimeout(forceExit);
      logger.error(`${processName}: error during shutdown`, {
        step: currentStep,
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error(`${processName}: unhandled promise rejection`, {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}
