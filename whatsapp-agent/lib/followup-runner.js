// followup-runner.js — Cron que roda diariamente e dispara follow-ups pendentes
// Janelas: 09:00 e 17:00 (dias úteis + sábado manhã)
// Sábado 09h e 10h permitido; domingo bloqueado

import cron from 'node-cron';
import { getLeadsPendentesFollowup, gerarMensagemFollowup, avancarPasso } from './cadencia.js';
import { getRecentMessages } from './storage.js';
import { enviarFollowup } from './conversation.js';
import { log } from './logger.js';

const JANELAS_HORA = [9, 17]; // horas em que o cron efetivamente envia

function dentroDaJanela() {
  const agora  = new Date();
  const dia    = agora.getDay(); // 0=dom, 6=sab
  const hora   = agora.getHours();

  if (dia === 0) return false; // domingo — nunca
  if (dia === 6 && hora >= 12) return false; // sábado tarde — não

  return JANELAS_HORA.includes(hora);
}

async function rodarFollowups() {
  if (!dentroDaJanela()) return;

  const pendentes = getLeadsPendentesFollowup();
  if (!pendentes.length) {
    log.info('Follow-up: nenhum lead pendente', {});
    return;
  }

  log.info('Follow-up: iniciando rodada', { total: pendentes.length });

  for (const lead of pendentes) {
    const { phone, name, cadencia } = lead;
    const passo = (cadencia.passo || 0) + 1;

    try {
      const historico = await getRecentMessages(phone, 10);
      const mensagem  = await gerarMensagemFollowup({ phone, name, passo, historico });

      if (!mensagem) {
        log.warn('Follow-up: mensagem vazia, pulando', { phone, passo });
        continue;
      }

      await enviarFollowup(phone, mensagem);

      avancarPasso(phone);

      log.info('Follow-up enviado', { phone, name, passo });

      // Intervalo entre envios pra não sobrecarregar
      await new Promise(r => setTimeout(r, 3000));

    } catch (e) {
      log.error('Follow-up: erro ao processar lead', { phone, passo, err: e.message });
    }
  }

  log.info('Follow-up: rodada concluída', { total: pendentes.length });
}

export function iniciarFollowupCron() {
  // Roda a cada hora cheia — a função internamente verifica se é janela válida
  cron.schedule('0 * * * *', () => {
    rodarFollowups().catch(e =>
      log.error('Follow-up: falha na rodada cron', { err: e.message })
    );
  });

  log.info('Follow-up cron iniciado (verifica a cada hora, dispara às 9h e 17h)', {});
}
