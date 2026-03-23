/**
 * Worker LLM — task hija en BullMQ Flows.
 * Procesa SOLO la generación LLM, desacoplado del worker de mensajes.
 * Concurrencia 1 para controlar uso de RAM en Termux.
 */

import { generateLLMResponse } from '../tasks/index.js';
import { whatsappAgent } from '../mastra/agent.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

logger.info('Starting LLM worker...');

generateLLMResponse.startWorker();

// Sobreescribir el handler de generateLLMResponse con la implementación real
const llmWorker = generateLLMResponse.startWorker();

// Acceder internamente al worker para re-registrar el handler real
import { Worker } from 'bullmq';
import { connectionOptions } from '../config/redis.js';
import type { LLMGeneratePayload, LLMGenerateResult } from '../tasks/index.js';

const realLLMWorker = new Worker<LLMGeneratePayload, LLMGenerateResult>(
  'wa:llm-generate',
  async (job) => {
    const { threadId, userMessage, resourceId } = job.data;
    logger.info({ threadId, msgLen: userMessage.length }, 'LLM generating...');

    const response = await whatsappAgent.generate(userMessage, {
      resourceId,
      threadId,
    });

    return {
      text: response.text,
      tokensUsed: response.usage?.totalTokens,
    };
  },
  { ...connectionOptions, concurrency: 1 }
);

realLLMWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'LLM job completed');
});

realLLMWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'LLM job failed');
});

logger.info('LLM worker ready');
