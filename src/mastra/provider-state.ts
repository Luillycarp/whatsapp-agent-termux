/**
 * Provider State — única fuente de verdad del provider activo en runtime.
 *
 * Jerarquía de precedencia:
 *   1. provider.state.json  (runtime, más prioritario)
 *   2. Comando WhatsApp     (escribe en el archivo de estado)
 *   3. .env variables       (base, solo si el archivo no existe)
 *
 * El archivo persiste entre reinicios del proceso.
 * Borrar el archivo = volver al .env.
 */

import fs from 'fs';
import path from 'path';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const STATE_FILE = path.resolve('./provider.state.json');

export type ProviderName = 'groq' | 'openrouter' | 'ollama';
export type ProviderStrategy = 'single' | 'fallback' | 'roundrobin' | 'combined';

export interface ProviderState {
  /** Estrategia activa */
  strategy: ProviderStrategy;
  /** Provider primario (usado en single, primero en fallback, base en roundrobin) */
  primary: ProviderName;
  /** Provider secundario para fallback y alternancia */
  secondary: ProviderName;
  /** Turno actual del round-robin (0 = primary, 1 = secondary) */
  rrTurn: number;
  /** Contador de fallbacks ocurridos en esta sesión */
  fallbackCount: number;
  /** Timestamp del último cambio */
  updatedAt: string;
}

const DEFAULT_STATE: ProviderState = {
  strategy: (process.env.PROVIDER_STRATEGY as ProviderStrategy) ?? 'single',
  primary: (process.env.LLM_PROVIDER as ProviderName) ?? 'groq',
  secondary: (process.env.LLM_PROVIDER_SECONDARY as ProviderName) ?? 'openrouter',
  rrTurn: 0,
  fallbackCount: 0,
  updatedAt: new Date().toISOString(),
};

/** Lee el estado desde archivo. Si no existe, usa DEFAULT_STATE. */
export function readState(): ProviderState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch (err) {
    logger.warn({ err }, 'provider-state: error leyendo archivo, usando defaults');
  }
  return { ...DEFAULT_STATE };
}

/** Escribe el estado en archivo. Merge con estado actual. */
export function writeState(patch: Partial<ProviderState>): ProviderState {
  const current = readState();
  const next: ProviderState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf-8');
    logger.info({ state: next }, 'provider-state: estado actualizado');
  } catch (err) {
    logger.error({ err }, 'provider-state: error escribiendo archivo');
  }
  return next;
}

/** Elimina el archivo de estado. El sistema vuelve al .env. */
export function resetState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
      logger.info('provider-state: archivo eliminado, volviendo a .env');
    }
  } catch (err) {
    logger.error({ err }, 'provider-state: error eliminando archivo');
  }
}

/**
 * Avanza el turno del round-robin y persiste.
 * Devuelve el provider que le toca en ESTE turno.
 */
export function advanceRoundRobin(): ProviderName {
  const state = readState();
  const chosen = state.rrTurn === 0 ? state.primary : state.secondary;
  writeState({ rrTurn: state.rrTurn === 0 ? 1 : 0 });
  return chosen;
}

/** Incrementa el contador de fallbacks y persiste. */
export function incrementFallback(): void {
  const state = readState();
  writeState({ fallbackCount: state.fallbackCount + 1 });
}

/** Devuelve un resumen legible del estado para el comando !provider status */
export function formatStatus(): string {
  const s = readState();
  const strategyEmoji: Record<ProviderStrategy, string> = {
    single: '🔵',
    fallback: '🟡',
    roundrobin: '🔄',
    combined: '🟢',
  };
  return [
    `╔═══ PROVIDER STATUS ══════════════════════════╗`,
    `║ Estrategia : ${strategyEmoji[s.strategy]} ${s.strategy.toUpperCase()}`,
    `║ Primario   : ${s.primary}`,
    `║ Secundario : ${s.secondary}`,
    `║ RR turno   : ${s.rrTurn === 0 ? s.primary : s.secondary} (siguiente)`,
    `║ Fallbacks  : ${s.fallbackCount} en esta sesión`,
    `║ Actualizado: ${new Date(s.updatedAt).toLocaleString('es-AR')}`,
    `╚══════════════════════════════════════════╝`,
  ].join('\n');
}

/** Devuelve el menú de ayuda de comandos */
export function formatHelp(): string {
  return [
    `🤖 *Comandos de provider:*`,
    ``,
    `*!provider status*`,
    `  Ver estado actual`,
    ``,
    `*!provider groq*`,
    `*!provider openrouter*`,
    `  Cambiar provider primario`,
    ``,
    `*!provider single*`,
    `  Un solo provider fijo`,
    ``,
    `*!provider fallback*`,
    `  Primario con fallback automático al secundario si falla`,
    ``,
    `*!provider roundrobin*`,
    `  Alternar entre primario y secundario por mensaje`,
    ``,
    `*!provider combined*`,
    `  Round-robin + fallback si el elegido falla`,
    ``,
    `*!provider reset*`,
    `  Volver a la config del .env`,
  ].join('\n');
}
