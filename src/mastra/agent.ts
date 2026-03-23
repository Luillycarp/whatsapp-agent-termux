/**
 * Agente principal de WhatsApp.
 * Recibe mensajes, usa memoria por-usuario y puede usar tools.
 */

import { Agent } from '@mastra/core/agent';
import { createGroq } from '@ai-sdk/groq';
import { agentMemory } from './memory.js';
import { datetimeTool } from './tools/datetime.tool.js';
import { webSearchTool } from './tools/web-search.tool.js';

// Seleccionar proveedor LLM según .env
function getLLMModel() {
  const provider = process.env.LLM_PROVIDER ?? 'groq';

  if (provider === 'groq') {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return groq(process.env.GROQ_MODEL ?? 'llama-3.1-70b-versatile');
  }

  // Ollama: usar AI SDK con base URL personalizada
  if (provider === 'ollama') {
    const { createOllama } = require('ollama-ai-provider');
    const ollama = createOllama({ baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434' });
    return ollama(process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b');
  }

  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}

export const whatsappAgent = new Agent({
  name: 'WhatsApp Assistant',
  instructions: `Sos un asistente personal de WhatsApp.
Respondé de forma clara, concisa y en el mismo idioma que usa el usuario.
Podés recordar conversaciones anteriores gracias a tu memoria.
Tenés acceso a la fecha/hora actual y a búsqueda web si necesitás información actualizada.
Si no sabés algo, decílo honestamente en lugar de inventar.`,
  model: getLLMModel(),
  memory: agentMemory,
  tools: {
    datetimeTool,
    webSearchTool,
  },
});
