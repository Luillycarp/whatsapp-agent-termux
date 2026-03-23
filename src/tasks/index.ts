/**
 * Registro central de DurableTasks.
 * Importar desde aquí en gateway y workers.
 */

import { DurableTask } from './durable.js';

export interface IncomingMessagePayload {
  from: string;
  text: string;
  threadId: string;
  timestamp: number;
}

export interface MessageProcessResult {
  reply: string;
  tokensUsed?: number;
}

export interface LLMGeneratePayload {
  threadId: string;
  userMessage: string;
  resourceId: string;
}

export interface LLMGenerateResult {
  text: string;
  tokensUsed?: number;
}

// Task principal: procesa mensaje entrante de WhatsApp
export const processIncomingMessage = new DurableTask<
  IncomingMessagePayload,
  MessageProcessResult
>('wa:process-message', async (input, log) => {
  // Este handler es un placeholder — el worker real lo sobreescribe
  // con startWorker(). Aquí sólo se define el tipo.
  log.info(input, 'processIncomingMessage placeholder — worker not started here');
  throw new Error('Worker not initialized for this task');
}, { attempts: 3, concurrency: 2 });

// Task hija: llamada al LLM (usada en BullMQ Flows)
export const generateLLMResponse = new DurableTask<
  LLMGeneratePayload,
  LLMGenerateResult
>('wa:llm-generate', async (input, log) => {
  log.info(input, 'generateLLMResponse placeholder — worker not started here');
  throw new Error('Worker not initialized for this task');
}, { attempts: 2, concurrency: 1 });
