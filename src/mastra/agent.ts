/**
 * Agente principal de WhatsApp.
 *
 * El modelo LLM se resuelve desde providers.ts — soporta:
 *   - Groq (groq)
 *   - OpenRouter (openrouter)
 *   - Ollama local ARM64 (ollama)
 *
 * Cambiar proveedor: editar LLM_PROVIDER en .env, reiniciar.
 */

import { Agent } from '@mastra/core/agent';
import { agentMemory } from './memory.js';
import { datetimeTool } from './tools/datetime.tool.js';
import { webSearchTool } from './tools/web-search.tool.js';
import { getModel, getProviderInfo } from './providers.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Log del provider activo al inicializar
const { provider, model } = getProviderInfo();
logger.info({ provider, model }, 'WhatsApp Agent — provider config');

export const whatsappAgent = new Agent({
  name: 'WhatsApp Assistant',
  instructions: `Sos un asistente personal de WhatsApp.
Respondé de forma clara, concisa y en el mismo idioma que usa el usuario.
Podés recordar conversaciones anteriores gracias a tu memoria.
Tenés acceso a la fecha/hora actual y a búsqueda web si necesitás información actualizada.
Si no sabés algo, decílo honestamente en lugar de inventar.
Se breve en tus respuestas a menos que el usuario pida explicitamente más detalle.`,
  model: {
    specificationVersion: 'v1',
    provider,
    modelId: model,
    defaultObjectGenerationMode: 'json',
    async doGenerate(options) {
      const m = await getModel();
      return m.doGenerate(options);
    },
    async doStream(options) {
      const m = await getModel();
      return m.doStream(options);
    },
  } as any,
  memory: agentMemory,
  tools: {
    datetimeTool,
    webSearchTool,
  },
});
