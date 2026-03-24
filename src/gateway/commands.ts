/**
 * Commands — intercepta mensajes que empiezan con !provider
 * y ejecuta el control del sistema de providers en runtime.
 *
 * Comandos disponibles:
 *   !provider status      — ver estado actual
 *   !provider help        — ver todos los comandos
 *   !provider groq        — cambiar provider primario a Groq
 *   !provider openrouter  — cambiar provider primario a OpenRouter
 *   !provider ollama      — cambiar provider primario a Ollama
 *   !provider single      — estrategia: un solo provider
 *   !provider fallback    — estrategia: fallback automático
 *   !provider roundrobin  — estrategia: alternar por mensaje
 *   !provider combined    — estrategia: roundrobin + fallback
 *   !provider reset       — volver a la config del .env
 */

import {
  readState,
  writeState,
  resetState,
  formatStatus,
  formatHelp,
  invalidateModelCache,
  type ProviderName,
  type ProviderStrategy,
} from '../mastra/provider-state.js';
import { invalidateModelCache as invalidateCache } from '../mastra/providers.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const VALID_PROVIDERS: ProviderName[] = ['groq', 'openrouter', 'ollama'];
const VALID_STRATEGIES: ProviderStrategy[] = ['single', 'fallback', 'roundrobin', 'combined'];

/**
 * Procesa un mensaje de texto.
 * Devuelve la respuesta si es un comando, o null si no es un comando.
 */
export function handleCommand(text: string): string | null {
  const trimmed = text.trim().toLowerCase();

  if (!trimmed.startsWith('!provider')) return null;

  const parts = trimmed.split(/\s+/);
  const subcommand = parts[1] ?? 'help';

  logger.info({ subcommand }, 'Command received: !provider');

  // ── status ──────────────────────────────────────────────────────
  if (subcommand === 'status') {
    return formatStatus();
  }

  // ── help ───────────────────────────────────────────────────────
  if (subcommand === 'help') {
    return formatHelp();
  }

  // ── reset ──────────────────────────────────────────────────────
  if (subcommand === 'reset') {
    resetState();
    invalidateCache();
    return [
      '✅ Estado reseteado.',
      `Volviendo a config del .env:`,
      `  Provider: ${process.env.LLM_PROVIDER ?? 'groq'}`,
      `  Estrategia: ${process.env.PROVIDER_STRATEGY ?? 'single'}`,
    ].join('\n');
  }

  // ── cambiar provider primario ─────────────────────────────────────
  if (VALID_PROVIDERS.includes(subcommand as ProviderName)) {
    const newPrimary = subcommand as ProviderName;
    const current = readState();
    // Si el nuevo primario es el mismo que el secundario, swapear
    const newSecondary = newPrimary === current.secondary
      ? current.primary
      : current.secondary;

    writeState({ primary: newPrimary, secondary: newSecondary, rrTurn: 0 });
    invalidateCache(newPrimary);

    return [
      `✅ Provider primario cambiado a *${newPrimary}*`,
      `  Secundario: ${newSecondary}`,
      `  Estrategia: ${current.strategy}`,
      `  El próximo mensaje usará ${newPrimary}.`,
    ].join('\n');
  }

  // ── cambiar estrategia ────────────────────────────────────────────
  if (VALID_STRATEGIES.includes(subcommand as ProviderStrategy)) {
    const newStrategy = subcommand as ProviderStrategy;
    writeState({ strategy: newStrategy, rrTurn: 0, fallbackCount: 0 });

    const descriptions: Record<ProviderStrategy, string> = {
      single:     'Un solo provider fijo.',
      fallback:   'Primario con fallback automático si falla.',
      roundrobin: 'Alterna entre primario y secundario por mensaje.',
      combined:   'Round-robin + fallback si el elegido falla.',
    };

    return [
      `✅ Estrategia cambiada a *${newStrategy}*`,
      `  ${descriptions[newStrategy]}`,
      `  Turno RR reseteado.`,
    ].join('\n');
  }

  // ── comando desconocido ────────────────────────────────────────────
  return [
    `❌ Comando desconocido: *!provider ${subcommand}*`,
    `Escribí *!provider help* para ver los comandos disponibles.`,
  ].join('\n');
}
