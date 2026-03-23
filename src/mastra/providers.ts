/**
 * Provider Factory — resuelve el modelo LLM según LLM_PROVIDER en .env
 *
 * Proveedores soportados:
 *   groq        — Groq Cloud (llama-3.3, gemma, qwen, etc.)
 *   openrouter  — OpenRouter.ai (acceso a 200+ modelos: GPT-4o, Claude, Gemini, etc.)
 *   ollama      — Ollama local ARM64 (compatible con Termux)
 *
 * Todos usan Vercel AI SDK como capa de abstracción unificada.
 * El módulo exporta getModel() que es lazy + cacheado.
 */

import type { LanguageModelV1 } from 'ai';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Cache del modelo resuelto—evita re-instanciar en cada llamada
let _cachedModel: LanguageModelV1 | null = null;

// ─── Groq ──────────────────────────────────────────────────────────────────────
// Modelos recomendados gratuitos (console.groq.com):
//   llama-3.3-70b-versatile   → mejor calidad, 6k req/día gratis
//   llama-3.1-8b-instant      → más rápido, menor latencia
//   gemma2-9b-it              → Google Gemma 2, liviano
//   qwen-qwq-32b              → razonamiento avanzado

async function buildGroqModel(): Promise<LanguageModelV1> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('[Provider] GROQ_API_KEY no definida en .env');

  const { createGroq } = await import('@ai-sdk/groq');
  const groq = createGroq({ apiKey });
  const model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

  logger.info({ provider: 'groq', model }, 'LLM provider initialized');
  return groq(model) as LanguageModelV1;
}

// ─── OpenRouter ────────────────────────────────────────────────────────────────
// OpenRouter da acceso unificado a 200+ modelos con una sola API key.
// Modelos gratuitos (free tier con :free suffix):
//   google/gemini-2.0-flash-exp:free
//   meta-llama/llama-3.3-70b-instruct:free
//   deepseek/deepseek-chat:free
//   mistralai/mistral-7b-instruct:free
//
// Modelos de pago de alta calidad:
//   anthropic/claude-3.5-sonnet
//   openai/gpt-4o
//   google/gemini-2.0-flash
//   deepseek/deepseek-r1
//
// Obtener API key: https://openrouter.ai/keys

async function buildOpenRouterModel(): Promise<LanguageModelV1> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('[Provider] OPENROUTER_API_KEY no definida en .env');

  const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
  const openrouter = createOpenRouter({
    apiKey,
    // Headers recomendados por OpenRouter para tracking y ranking
    extraHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'WhatsApp Agent Termux',
    },
  });

  const model = process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free';
  logger.info({ provider: 'openrouter', model }, 'LLM provider initialized');
  return openrouter(model) as LanguageModelV1;
}

// ─── Ollama (local ARM64) ──────────────────────────────────────────────────────
// Modelos recomendados según RAM disponible:
//   qwen2.5:1.5b   → ~1GB RAM, mnimo funcional en phones 4GB
//   qwen2.5:3b     → ~2GB RAM, buena calidad
//   llama3.2:3b    → ~2GB RAM, buena alternativa
//   gemma3:4b      → ~3GB RAM, excelente para phones 6GB+
//
// Instalar en Termux: pkg install ollama && ollama pull qwen2.5:1.5b

async function buildOllamaModel(): Promise<LanguageModelV1> {
  const { createOllama } = await import('ollama-ai-provider');
  const baseURL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/api';
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b';

  const ollama = createOllama({ baseURL });
  logger.info({ provider: 'ollama', model, baseURL }, 'LLM provider initialized');
  return ollama(model) as LanguageModelV1;
}

// ─── Factory principal ─────────────────────────────────────────────────────────

export async function buildModel(): Promise<LanguageModelV1> {
  const provider = (process.env.LLM_PROVIDER ?? 'groq').toLowerCase();

  switch (provider) {
    case 'groq':
      return buildGroqModel();
    case 'openrouter':
      return buildOpenRouterModel();
    case 'ollama':
      return buildOllamaModel();
    default:
      throw new Error(
        `[Provider] LLM_PROVIDER="${provider}" no válido. Opciones: groq | openrouter | ollama`
      );
  }
}

/**
 * getModel() — resuelve y cachea el modelo.
 * Llamar desde agent.ts y cualquier otro lugar que necesite el LLM.
 */
export async function getModel(): Promise<LanguageModelV1> {
  if (!_cachedModel) {
    _cachedModel = await buildModel();
  }
  return _cachedModel;
}

/**
 * Invalida el cache del modelo.
 * Útil si se cambia LLM_PROVIDER en runtime (tests, hot-reload).
 */
export function invalidateModelCache(): void {
  _cachedModel = null;
}

/**
 * Devuelve información del provider activo para logs y dashboard.
 */
export function getProviderInfo(): { provider: string; model: string } {
  const provider = process.env.LLM_PROVIDER ?? 'groq';
  const models: Record<string, string> = {
    groq: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    openrouter: process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free',
    ollama: process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b',
  };
  return { provider, model: models[provider] ?? 'unknown' };
}
