/**
 * DurableTask — wrapper sobre BullMQ que replica la DX de trigger.dev.
 * Una función = una Queue + un Worker, auto-configurados.
 *
 * Inspirado en: https://www.svendewaerhert.com/blog/durable-task-primitive-with-bullmq/
 */

import { Queue, Worker, type Job, type WorkerOptions } from 'bullmq';
import { connectionOptions } from '../config/redis.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

type TaskHandler<TInput, TOutput> = (
  input: TInput,
  log: typeof logger
) => Promise<TOutput>;

interface DurableTaskOptions {
  /** Intentos de reintento ante fallo (default: 3) */
  attempts?: number;
  /** Delay base en ms para backoff exponencial (default: 1000) */
  backoffDelay?: number;
  /** Concurrencia del worker (default: 1 para ahorrar RAM en Termux) */
  concurrency?: number;
  /** Remover jobs completados después de N segundos (default: 3600) */
  removeOnCompleteAge?: number;
}

export class DurableTask<TInput = unknown, TOutput = unknown> {
  private queue: Queue<TInput, TOutput>;
  private worker: Worker<TInput, TOutput> | null = null;
  public readonly name: string;

  constructor(
    name: string,
    private handler: TaskHandler<TInput, TOutput>,
    private options: DurableTaskOptions = {}
  ) {
    this.name = name;
    this.queue = new Queue<TInput, TOutput>(name, {
      ...connectionOptions,
      defaultJobOptions: {
        attempts: options.attempts ?? 3,
        backoff: {
          type: 'exponential',
          delay: options.backoffDelay ?? 1000,
        },
        removeOnComplete: { age: options.removeOnCompleteAge ?? 3600 },
        removeOnFail: { count: 50 },
      },
    });
  }

  /**
   * Encola una nueva ejecución (fire & forget)
   */
  async call(input: TInput, jobId?: string) {
    return this.queue.add(this.name, input, { jobId });
  }

  /**
   * Encola y espera el resultado (blocking)
   */
  async callSync(input: TInput, timeoutMs = 30_000): Promise<TOutput> {
    const job = await this.call(input);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('DurableTask timeout')), timeoutMs);
      const check = setInterval(async () => {
        const state = await job.getState();
        if (state === 'completed') {
          clearInterval(check);
          clearTimeout(timeout);
          resolve((await job.returnvalue) as TOutput);
        } else if (state === 'failed') {
          clearInterval(check);
          clearTimeout(timeout);
          reject(new Error(job.failedReason));
        }
      }, 300);
    });
  }

  /**
   * Inicia el worker para esta tarea.
   * Llamar desde el proceso worker, no desde el gateway.
   */
  startWorker(workerOptions?: Partial<WorkerOptions>) {
    this.worker = new Worker<TInput, TOutput>(
      this.name,
      async (job: Job<TInput, TOutput>) => {
        const taskLog = logger.child({ taskName: this.name, jobId: job.id });
        taskLog.info({ input: job.data }, 'task:start');
        try {
          const result = await this.handler(job.data, taskLog);
          taskLog.info({ result }, 'task:completed');
          return result;
        } catch (err) {
          taskLog.error({ err }, 'task:failed');
          throw err;
        }
      },
      {
        ...connectionOptions,
        concurrency: this.options.concurrency ?? 1,
        ...workerOptions,
      }
    );

    this.worker.on('failed', (job, err) => {
      logger.warn({ jobId: job?.id, err }, `${this.name}:worker:failed`);
    });

    logger.info(`DurableTask worker started: ${this.name}`);
    return this.worker;
  }

  getQueue() {
    return this.queue;
  }
}
