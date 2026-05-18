// Coalesce: agrupa varias mensagens consecutivas do mesmo lead antes de responder.
// Sem isso o Charles responde 3x quando o lead manda "oi", "tudo bem?", "tem aluguel?"
// em bolhas separadas, ou "fala sozinho" quando o lead manda "k" / "espera".
//
// Fluxo:
//  - Cada inbound do mesmo phone entra numa fila.
//  - Reseta um timer de COALESCE_MS toda vez que chega nova msg.
//  - Quando o timer expira sem novas msgs, drena a fila e chama o handler 1 vez.
//  - Se ja esta processando uma resposta para esse phone, a nova msg fica em
//    espera e re-agenda o flush apos terminar (assim "espera, deixa eu pensar"
//    chegado no meio nao vira uma resposta paralela).
import { log } from './logger.js';

const COALESCE_MS = parseInt(process.env.COALESCE_MS, 10) || 4000;
const inbox = new Map();      // phone -> { timer, queue: [] }
const processing = new Set(); // phones com handler em execucao agora

export function coalesceIncoming(phone, msg, handler) {
  if (!phone) return;
  if (!inbox.has(phone)) inbox.set(phone, { timer: null, queue: [] });
  const slot = inbox.get(phone);
  slot.queue.push(msg);
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => flush(phone, handler), COALESCE_MS);
  log.debug('Coalescer empilhado', { phone, queueSize: slot.queue.length, debounceMs: COALESCE_MS });
}

async function flush(phone, handler) {
  // Se ainda estamos respondendo a um batch anterior, espera e reagenda.
  if (processing.has(phone)) {
    const slot = inbox.get(phone);
    if (slot) {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = setTimeout(() => flush(phone, handler), COALESCE_MS);
    }
    log.debug('Coalescer aguardando handler anterior', { phone });
    return;
  }
  const slot = inbox.get(phone);
  if (!slot || slot.queue.length === 0) return;

  // Drena a fila e libera o slot pra novas msgs do lead durante o processamento.
  const batch = slot.queue.splice(0);
  slot.timer = null;
  inbox.delete(phone);
  processing.add(phone);

  log.info('Coalescer disparou', { phone, batchSize: batch.length });
  try {
    await handler(batch);
  } catch (err) {
    log.error('Handler do coalescer falhou', { phone, err: err.message, stack: err.stack });
  } finally {
    processing.delete(phone);
    // Se o lead mandou mais msgs durante o processamento, ja existe novo slot no
    // inbox (recriado pelo coalesceIncoming). O setTimeout dele dispara normal.
  }
}

// Util pra teste / shutdown limpo
export function _drainAll() {
  for (const [phone, slot] of inbox.entries()) {
    if (slot.timer) clearTimeout(slot.timer);
  }
  inbox.clear();
  processing.clear();
}
