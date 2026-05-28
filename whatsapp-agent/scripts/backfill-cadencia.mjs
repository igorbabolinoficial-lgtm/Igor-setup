// backfill-cadencia.mjs — Script one-shot para ativar cadência nos leads existentes
// que receberam mensagem do bot mas não responderam desde então.
//
// Uso: node scripts/backfill-cadencia.mjs [--dry-run]
//
// O que faz:
//   1. Busca todos os leads com ao menos uma mensagem outbound (bot)
//   2. Para cada lead, verifica se a última mensagem foi outbound (sem resposta do lead depois)
//   3. Se sim, e se ainda não tem cadencia setada, ativa com passo=0 e proximo_followup_em=agora+24h
//
// Pula leads que:
//   - Já têm meta.cadencia definida (não sobrescreve)
//   - Têm human_takeover ativo
//   - Última mensagem foi inbound (lead respondeu por último — não precisa de follow-up)
//   - Não têm nenhuma mensagem outbound (nunca foram contatados pelo bot)

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DRY_RUN  = process.argv.includes('--dry-run');
const DB_PATH  = process.env.DB_PATH || path.join(__dirname, '..', 'wa-agent.db');

const INTERVALO_PRIMEIRO_FOLLOWUP_MS = 24 * 60 * 60 * 1000; // 24h

console.log(`\nBackfill cadência — ${DRY_RUN ? 'DRY RUN (nenhuma alteração)' : 'MODO REAL'}`);
console.log(`DB: ${DB_PATH}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Busca todos os leads que têm ao menos 1 mensagem outbound
const leads = db.prepare(`
  SELECT l.phone, l.name, l.meta
  FROM leads l
  WHERE EXISTS (
    SELECT 1 FROM whatsapp_messages m
    WHERE m.phone = l.phone AND m.direction = 'out'
  )
  ORDER BY l.last_whatsapp_at DESC
`).all();

console.log(`Leads com mensagens do bot: ${leads.length}`);

let ativados  = 0;
let pulados   = 0;
let detalhes  = [];

for (const lead of leads) {
  const { phone, name } = lead;

  let meta = {};
  try { meta = JSON.parse(lead.meta || '{}'); } catch { meta = {}; }

  // Pula se já tem cadencia configurada
  if (meta.cadencia) {
    pulados++;
    detalhes.push({ phone, motivo: 'cadencia já existe' });
    continue;
  }

  // Pula se human_takeover ativo
  if (meta.human_takeover_until && new Date(meta.human_takeover_until) > new Date()) {
    pulados++;
    detalhes.push({ phone, motivo: 'human_takeover ativo' });
    continue;
  }

  // Pega a última mensagem da conversa
  const ultima = db.prepare(`
    SELECT direction, created_at FROM whatsapp_messages
    WHERE phone = ? ORDER BY created_at DESC LIMIT 1
  `).get(phone);

  if (!ultima) {
    pulados++;
    detalhes.push({ phone, motivo: 'sem mensagens' });
    continue;
  }

  // Pula se última mensagem foi inbound (lead respondeu por último)
  if (ultima.direction === 'in') {
    pulados++;
    detalhes.push({ phone, motivo: 'última msg foi do lead (inbound)' });
    continue;
  }

  // última mensagem foi outbound — lead não respondeu
  // Pega data da última mensagem outbound como referência
  const ultimaOut = db.prepare(`
    SELECT created_at FROM whatsapp_messages
    WHERE phone = ? AND direction = 'out'
    ORDER BY created_at DESC LIMIT 1
  `).get(phone);

  const ultimoContatoEm = ultimaOut?.created_at || new Date().toISOString();
  const proximoFollowupEm = new Date(Date.now() + INTERVALO_PRIMEIRO_FOLLOWUP_MS).toISOString();

  const cadencia = {
    passo:                0,
    pausado:              false,
    total_enviados:       0,
    ultimo_followup_em:   ultimoContatoEm,
    proximo_followup_em:  proximoFollowupEm,
  };

  meta.cadencia = cadencia;

  if (!DRY_RUN) {
    db.prepare('UPDATE leads SET meta = ? WHERE phone = ?')
      .run(JSON.stringify(meta), phone);
  }

  ativados++;
  detalhes.push({
    phone,
    name: name || '(sem nome)',
    motivo: `ativado — próximo follow-up em ${proximoFollowupEm}`,
  });
}

// Relatório
console.log(`\nResultado:`);
console.log(`  Ativados:  ${ativados}`);
console.log(`  Pulados:   ${pulados}`);
console.log(`  Total:     ${leads.length}\n`);

if (detalhes.length) {
  console.log('Detalhes:');
  for (const d of detalhes) {
    console.log(`  ${d.phone}  ${d.name ? `(${d.name})` : ''}  → ${d.motivo}`);
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] Nenhuma linha foi alterada. Rode sem --dry-run para aplicar.');
}

console.log('\nConcluído.\n');
db.close();
