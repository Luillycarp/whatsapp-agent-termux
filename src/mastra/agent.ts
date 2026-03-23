/**
 * Agente principal de WhatsApp.
 * Recibe mensajes, usa memoria por-usuario y puede usar tools.
 *
 * FIX: la versión anterior usaba require() (CommonJS) dentro de un módulo
 * ESM ("type": "module" en package.json), lo que causa:
 *   ReferenceError: require is not defined in ES module scope
 * Se reemplaza por import dinámico async para el provider Ollama.
 */

import { Agent } from '@mastra/core/agent';
import { createGroq } from '@ai-sdk/groq';
import { agentMemory } from './memory.js';
import { datetimeTool } from './tools/datetime.tool.js';
import { webSearchTool } from './tools/web-search.tool.js';
import type { LanguageModelV1 } from 'ai';

async function getLLMModel(): Promise<LanguageModelV1> {
  const provider = process.env.LLM_PROVIDER ?? 'groq';

  if (provider === 'groq') {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return groq(process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile') as LanguageModelV1;
  }

  if (provider === 'ollama') {
    // FIX: import dinámico ESM en lugar de require() CommonJS
    const { createOllama } = await import('ollama-ai-provider');
    const ollama = createOllama({
      baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/api',
    });
    return ollama(process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b') as LanguageModelV1;
  }

  throw new Error(`Unknown LLM_PROVIDER: "${provider}". Usar 'groq' o 'ollama'.`);
}

// El Agent de Mastra acepta model como promesa o valor resuelto
// Se inicializa de forma lazy en el primer uso
let _model: LanguageModelV1 | null = null;

async function getModel(): Promise<LanguageModelV1> {
  if (!_model) _model = await getLLMModel();
  return _model;
}

// El agente se crea con un getter lazy para el modelo
export const whatsappAgent = new Agent({
  name: 'WhatsApp Assistant',
  instructions: `Sos un asistente personal de WhatsApp.
Respondé de forma clara, concisa y en el mismo idioma que usa el usuario.
Podés recordar conversaciones anteriores gracias a tu memoria.
Tenés acceso a la fecha/hora actual y a búsqueda web si necesitás información actualizada.
Si no sabés algo, decílo honestamente en lugar de inventar.`,
  model: {
    // Wrapper para resolver el modelo de forma async en cada llamada
    async generate(messages, options) {
      const model = await getModel();
      return model.doGenerate({ ...options, inputFormat: 'messages', mode: { type: 'regular' }, prompt: messages } as any);
    },
    async stream(messages, options) {
      const model = await getModel();
      return model.doStream({ ...options, inputFormat: 'messages', mode: { type: 'regular' }, prompt: messages } as any);
    },
    specificationVersion: 'v1',
    provider: process.env.LLM_PROVIDER ?? 'groq',
    modelId: process.env.GROQ_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama-3.3-70b-versatile',
    defaultObjectGenerationMode: 'json',
  } as unknown as LanguageModelV1,
  memory: agentMemory,
  tools: {
    datetimeTool,
    webSearchTool,
  },
});
