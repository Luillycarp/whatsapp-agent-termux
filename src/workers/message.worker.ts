/**
 * Worker principal de mensajes WhatsApp.
 * Usa BullMQ Flows para orquestar sub-tasks:
 *   processIncomingMessage (parent)
 *     └── wa:llm-generate (child) ── espera resultado antes de responder
 */

import { Worker, FlowProducer } from 'bullmq';
import { connectionOptions } from '../config/redis.js';
import { sendTextMessage } from '../gateway/baileys.js';
import pino from 'pino';
import type { IncomingMessagePayload, MessageProcessResult } from '../tasks/index.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const flowProducer = new FlowProducer(connectionOptions);

logger.info('Starting message worker...');

const messageWorker = new Worker<IncomingMessagePayload, MessageProcessResult>(
  'wa:process-message',
  async (job) => {
    const { from, text, threadId, timestamp } = job.data;
    logger.info({ from, threadId }, 'Processing incoming message');

    // Crear flow: este job es el parent, llm-generate es el child
    // El parent se completa SOLO cuando el child termina
    const flow = await flowProducer.add({
      name: 'process-message-flow',
      queueName: 'wa:response-sender', // cola virtual de respuesta
      data: { from, threadId },
      children: [
        {
          name: 'llm-generate',
          queueName: 'wa:llm-generate',
          data: {
            threadId,
            userMessage: text,
            resourceId: from,
          },
          opts: { attempts: 2 },
        },
      ],
    });

    // Esperar resultado del child con polling
    const childValues = await flow.job.getChildrenValues();
    const llmResult = Object.values(childValues)[0] as { text: string; tokensUsed?: number };

    if (!llmResult?.text) {
      throw new Error('LLM child job did not return text');
    }

    logger.info({ from, reply: llmResult.text.slice(0, 80) }, 'Sending reply');
    await sendTextMessage(from, llmResult.text);

    return { reply: llmResult.text, tokensUsed: llmResult.tokensUsed };
  },
  { ...connectionOptions, concurrency: 2 }
);

messageWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, from: job.data.from }, 'Message processed successfully');
});

messageWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Message processing failed');
  // En caso de fallo, intentar notificar al usuario
  if (job?.data.from) {
    sendTextMessage(job.data.from, '⚠️ Hubo un error procesando tu mensaje. Intentá de nuevo.').catch(() => {});
  }
});

logger.info('Message worker ready');
