/**
 * Worker principal de mensajes WhatsApp.
 *
 * ARQUITECTURA FLOW:
 * Este worker recibe el job de la queue 'wa:process-message'.
 * En lugar de usar FlowProducer (que crea un parent NUEVO en otra queue),
 * llama directamente al agente Mastra para mantener la cadena simple.
 *
 * Para multi-step reasoning avanzado con FlowProducer, usar message.flow.worker.ts
 * (ver docs). El Flow requiere que el parent job sea encolado POR el FlowProducer,
 * no que un worker existente cree el Flow — ese era el bug original.
 *
 * FIX: importar sendTextMessage causaba inicializar el socket de Baileys
 * en el proceso worker (proceso separado). Se usa Redis pub/sub para
 * notificar al gateway que debe enviar el mensaje.
 */

import { Worker } from 'bullmq';
import { connectionOptions, redisSubscriber } from '../config/redis.js';
import { whatsappAgent } from '../mastra/agent.js';
import pino from 'pino';
import type { IncomingMessagePayload, MessageProcessResult } from '../tasks/index.js';
import Redis from 'ioredis';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Publisher separado para notificar al gateway que envíe el mensaje
const publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

logger.info('Starting message worker...');

const messageWorker = new Worker<IncomingMessagePayload, MessageProcessResult>(
  'wa:process-message',
  async (job) => {
    const { from, text, threadId } = job.data;
    logger.info({ from, threadId, jobId: job.id }, 'Processing incoming message');

    // Llamar directamente al agente Mastra (que internamente usa memoria)
    const response = await whatsappAgent.generate(text, {
      resourceId: from,
      threadId,
    });

    const reply = response.text;
    logger.info({ from, replyLen: reply.length, jobId: job.id }, 'Reply generated');

    // Publicar en canal Redis para que el gateway de Baileys envíe el mensaje
    // El gateway suscribe a este canal y llama a sock.sendMessage()
    await publisher.publish(
      'wa:send-message',
      JSON.stringify({ to: from, text: reply })
    );

    return { reply, tokensUsed: response.usage?.totalTokens };
  },
  {
    ...connectionOptions,
    concurrency: 2,
  }
);

messageWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, from: job.data.from }, 'Message processed successfully');
});

messageWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Message processing failed');
  // Notificar al usuario del error vía el mismo canal Redis
  if (job?.data.from) {
    publisher.publish(
      'wa:send-message',
      JSON.stringify({ to: job.data.from, text: '⚠️ Hubo un error procesando tu mensaje. Intentá de nuevo.' })
    ).catch(() => {});
  }
});

messageWorker.on('error', (err) => {
  logger.error({ err: err.message }, 'Message worker error');
});

logger.info('Message worker ready — listening on queue: wa:process-message');
