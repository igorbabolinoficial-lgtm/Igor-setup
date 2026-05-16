// Closer — fecha leads quentes (score >=65). Recebe handoff do SDR.
// Usa skill `contratos` pra minutar proposta, cria aprovação humana antes de enviar.

const { db, registrarLog } = require('../db');
const { gerarTexto, temAlgumLLM } = require('./ia');
const { heartbeat } = require('./base');
let contextoDNA = () => '';
try { ({ contextoDNA } = require('../routes/cerebro')); } catch (_) {}

module.exports = {
    chave: 'closer',
    descricao: 'Fecha leads quentes (score >=65)',
    tiposAceitos: ['mandar_proposta', 'agendar_visita', 'negociar'],

    async executar({ tipo, payload }) {
        if (tipo === 'mandar_proposta') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead ${payload.lead_id} nao encontrado`);

            // Dispara skill contratos com contexto do lead
            const { executarSkill } = require('../bot/skills');
            const input = `Proposta inicial pra ${lead.nome}. Interesse: ${lead.interesse || '-'}. Segmento: ${lead.segmento || '-'}. Notas: ${lead.notas || '-'}.`;
            const r = await executarSkill('contratos', input, { lead_id: lead.id });
            if (!r.ok) throw new Error(r.erro || 'skill contratos falhou');

            // Cria aprovação humana
            const aprovId = db.prepare(`
                INSERT INTO aprovacoes (agente_destino, tipo, payload, descricao)
                VALUES ('closer', 'mandar_proposta', ?, ?)
            `).run(
                JSON.stringify({ lead_id: lead.id, minuta: r.output }),
                `Proposta pra ${lead.nome} — aguardando aprovação do Igor`
            ).lastInsertRowid;

            heartbeat('closer');
            return { lead_id: lead.id, aprovacao_id: aprovId, minuta: r.output.slice(0, 500) };
        }

        if (tipo === 'agendar_visita') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead ${payload.lead_id} nao encontrado`);
            const quando = payload.quando || new Date(Date.now() + 2 * 86400000).toISOString();
            const { uid } = require('../db');
            const eventoId = uid('evt');
            db.prepare(`
                INSERT INTO agenda (id, titulo, descricao, lead_id, inicio, tipo)
                VALUES (?, ?, ?, ?, ?, 'reuniao')
            `).run(eventoId, `Visita: ${lead.nome}`, `Imóvel: ${payload.imovel_id || '?'}`, lead.id, quando);
            heartbeat('closer');
            return { evento_id: eventoId, lead_id: lead.id, agendado_para: quando };
        }

        if (tipo === 'negociar') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead ${payload.lead_id} nao encontrado`);
            if (!temAlgumLLM()) {
                registrarLog({ agente: 'closer', nivel: 'alerta', mensagem: `negociar sem LLM`, contexto: { lead_id: lead.id } });
                return { lead_id: lead.id, sugestao: 'Sem LLM. Negocie manualmente.' };
            }
            const dna = contextoDNA(1500);
            const prompt = `Você é o Closer do Igor Babolin Imóveis (Praia do Rosa). Sugira a próxima ação de negociação pra fechar este lead. Tom direto, sem floreio. Máx 4 linhas.

${dna ? `# TOM DA CASA\n${dna}\n` : ''}
# LEAD
Nome: ${lead.nome}
Interesse: ${lead.interesse || '-'}
Score: ${lead.score_ia}
Status: ${lead.status}
Segmento: ${lead.segmento || '-'}
Notas: ${lead.notas || '-'}
Última oferta/contra-oferta: ${payload.contexto || '-'}

Próxima ação (texto direto pro Igor humano executar):`;
            const r = await gerarTexto(prompt);
            heartbeat('closer');
            return { lead_id: lead.id, sugestao: r?.texto || 'IA indisponivel', modelo: r?.modelo };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
