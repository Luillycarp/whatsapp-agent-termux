/**
 * Provider Factory — resuelve el modelo LLM según la estrategia activa.
 *
 * Estrategias:
 *   single     — un solo provider fijo
 *   fallback   — primario con fallback automático al secundario si falla
 *   roundrobin — alterna entre primario y secundario por cada llamada
 *   combined   — round-robin + fallback si el elegido falla
 *
 * La estrategia se lee desde provider.state.json en cada llamada,
 * lo que permite cambios en runtime sin reiniciar el proceso.
 */

import type { LanguageModelV1 } from 'ai';
import pino from 'pino';
import {
  readState,
  advanceRoundRobin,
  incrementFallback,
  type ProviderName,
} from './provider-state.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Cache de instancias de modelos por provider name
const _modelCache = new Map<ProviderName, LanguageModelV1>();

// ─── Builders por provider ────────────────────────────────────────────────────

async function buildGroqModel(): Promise<LanguageModelV1> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('[Provider:groq] GROQ_API_KEY no definida');
  const { createGroq } = await import('@ai-sdk/groq');
  const model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
  logger.info({ provider: 'groq', model }, 'Model instantiated');
  return createGroq({ apiKey })(model) as LanguageModelV1;
}

async function buildOpenRouterModel(): Promise<LanguageModelV1> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('[Provider:openrouter] OPENROUTER_API_KEY no definida');
  const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
  const model = process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free';
  logger.info({ provider: 'openrouter', model }, 'Model instantiated');
  return createOpenRouter({
    apiKey,
    extraHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'WhatsApp Agent Termux',
    },
  })(model) as LanguageModelV1;
}

async function buildOllamaModel(): Promise<LanguageModelV1> {
  const { createOllama } = await import('ollama-ai-provider');
  const baseURL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/api';
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b';
  logger.info({ provider: 'ollama', model, baseURL }, 'Model instantiated');
  return createOllama({ baseURL })(model) as LanguageModelV1;
}

async function buildModel(name: ProviderName): Promise<LanguageModelV1> {
  switch (name) {
    case 'groq': return buildGroqModel();
    case 'openrouter': return buildOpenRouterModel();
    case 'ollama': return buildOllamaModel();
    default: throw new Error(`[Provider] Unknown provider: "${name}"`);
  }
}

/**
 * Obtiene el modelo para un provider, usando cache.
 * El cache se invalida automáticamente si cambia el provider.
 */
async function getModelForProvider(name: ProviderName): Promise<LanguageModelV1> {
  if (!_modelCache.has(name)) {
    _modelCache.set(name, await buildModel(name));
  }
  return _modelCache.get(name)!;
}

/** Invalida cache de un provider específico o de todos. */
export function invalidateModelCache(name?: ProviderName): void {
  if (name) _modelCache.delete(name);
  else _modelCache.clear();
}

// ─── Resolución con estrategia ───────────────────────────────────────────────────

/**
 * Intenta usar un provider con fallback automático al otro.
 * Registra el evento de fallback en el estado.
 */
async function withFallback(
  primary: ProviderName,
  secondary: ProviderName,
  call: (model: LanguageModelV1) => Promise<any>
): Promise<any> {
  try {
    const model = await getModelForProvider(primary);
    return await call(model);
  } catch (primaryErr: any) {
    logger.warn(
      { provider: primary, err: primaryErr.message },
      `Provider fallido, activando fallback a ${secondary}`
    );
    incrementFallback();
    // Invalidar cache del provider que falló para forzar re-instanciación
    invalidateModelCache(primary);
    const fallbackModel = await getModelForProvider(secondary);
    return await call(fallbackModel);
  }
}

/**
 * getModel() — devuelve el modelo correcto según la estrategia activa.
 *
 * Lee el estado en cada llamada (sin cache de estado) para permitir
 * cambios en runtime vía comandos WhatsApp o modificación del archivo.
 */
export async function getModel(): Promise<LanguageModelV1> {
  const state = readState();
  const { strategy, primary, secondary } = state;

  logger.debug({ strategy, primary, secondary }, 'getModel() resolving');

  switch (strategy) {
    case 'single': {
      return getModelForProvider(primary);
    }

    case 'fallback': {
      // Devuelve el primario. El fallback se activa en execute() del agente.
      // Para eso usamos un Proxy que captura doGenerate/doStream.
      return createStrategyProxy(primary, secondary, 'fallback');
    }

    case 'roundrobin': {
      const chosen = advanceRoundRobin();
      logger.info({ chosen }, 'Round-robin: provider elegido');
      return getModelForProvider(chosen);
    }

    case 'combined': {
      // Round-robin primero, luego fallback si el elegido falla
      const chosen = advanceRoundRobin();
      const other = chosen === primary ? secondary : primary;
      logger.info({ chosen, fallbackTo: other }, 'Combined: provider elegido');
      return createStrategyProxy(chosen, other, 'combined');
    }

    default:
      return getModelForProvider(primary);
  }
}

/**
 * Crea un Proxy sobre LanguageModelV1 que intercepta doGenerate y doStream
 * para aplicar fallback transparente.
 */
function createStrategyProxy(
  primary: ProviderName,
  secondary: ProviderName,
  strategyLabel: string
): LanguageModelV1 {
  const state = readState();

  return {
    specificationVersion: 'v1',
    provider: primary,
    modelId: primary,
    defaultObjectGenerationMode: 'json',

    async doGenerate(options) {
      return withFallback(primary, secondary, (m) => m.doGenerate(options));
    },

    async doStream(options) {
      return withFallback(primary, secondary, (m) => m.doStream(options));
    },
  } as unknown as LanguageModelV1;
}

/** Info del provider activo para logs */
export function getProviderInfo(): { provider: string; model: string; strategy: string } {
  const state = readState();
  const models: Record<ProviderName, string> = {
    groq: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    openrouter: process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free',
    ollama: process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b',
  };
  return {
    provider: state.primary,
    model: models[state.primary],
    strategy: state.strategy,
  };
}
