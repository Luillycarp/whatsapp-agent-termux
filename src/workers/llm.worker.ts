/**
 * Worker LLM — procesa las llamadas al agente Mastra.
 * Es la tarea CHILD en BullMQ Flows: recibe el mensaje del usuario
 * y devuelve el texto generado por el LLM.
 *
 * FIX: el archivo original creaba 3 instancias de Worker para la misma
 * queue (startWorker x2 + new Worker), lo que causa race conditions y
 * procesamiento duplicado. Ahora hay exactamente UN worker para 'wa:llm-generate'.
 */

import { Worker } from 'bullmq';
import { connectionOptions } from '../config/redis.js';
import { whatsappAgent } from '../mastra/agent.js';
import pino from 'pino';
import type { LLMGeneratePayload, LLMGenerateResult } from '../tasks/index.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

logger.info('Starting LLM worker...');

const llmWorker = new Worker<LLMGeneratePayload, LLMGenerateResult>(
  'wa:llm-generate',
  async (job) => {
    const { threadId, userMessage, resourceId } = job.data;
    logger.info({ threadId, jobId: job.id, msgLen: userMessage.length }, 'LLM generating...');

    const response = await whatsappAgent.generate(userMessage, {
      resourceId,
      threadId,
    });

    logger.info({ jobId: job.id, tokens: response.usage?.totalTokens }, 'LLM completed');

    return {
      text: response.text,
      tokensUsed: response.usage?.totalTokens,
    };
  },
  {
    ...connectionOptions,
    concurrency: 1, // Controlar uso de RAM en Termux
  }
);

llmWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'LLM job completed');
});

llmWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'LLM job failed');
});

llmWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'LLM worker error');
});

logger.info('LLM worker ready — listening on queue: wa:llm-generate');
