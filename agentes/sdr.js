const { db, registrarLog } = require('../db');
const { gerarTexto, extrairJson, temAlgumLLM } = require('./ia');
const { heartbeat } = require('./base');
let contextoDNA = () => '';
try { ({ contextoDNA } = require('../routes/cerebro')); } catch (_) {}

const SEGMENTOS = ['investidor', 'morar', 'veranear', 'urgente', 'longo_prazo'];
const PROXIMAS_ACOES = ['responder_dm', 'agendar_call', 'mandar_proposta', 'mandar_catalogo', 'aguardar', 'arquivar'];

// Resumo do catálogo pra dar fit no prompt — diferente do contexto público,
// foca em variedade pro SDR cruzar com o interesse declarado.
function resumoCatalogo() {
    const total = db.prepare("SELECT COUNT(*) AS n FROM imoveis").get().n;
    const porTipo = db.prepare("SELECT tipo, COUNT(*) AS n FROM imoveis GROUP BY tipo ORDER BY n DESC LIMIT 6").all();
    const faixas = db.prepare("SELECT MIN(preco) AS minimo, MAX(preco) AS maximo FROM imoveis WHERE preco > 0").get();
    return `Catálogo: ${total} imóveis. Tipos: ${porTipo.map(t => `${t.tipo || 'sem tipo'}(${t.n})`).join(', ')}. Faixa: R$${Number(faixas.minimo || 0).toLocaleString('pt-BR')} a R$${Number(faixas.maximo || 0).toLocaleString('pt-BR')}.`;
}

async function qualificarComIA(lead) {
    if (!temAlgumLLM()) return null;
    const dna = contextoDNA(2000);
    const catalogo = resumoCatalogo();

    const prompt = `Você é o SDR sênior da imobiliária Igor Babolin (Praia do Rosa - SC). Sua função é triagem cirúrgica: separar lead frio de lead que merece a atenção do Igor humano agora.

${dna ? `# DNA DA IMOBILIÁRIA (do Cérebro Obsidian)\n${dna}\n` : ''}
# CATÁLOGO ATUAL
${catalogo}

# LEAD
Nome: ${lead.nome}
Interesse: ${lead.interesse || '-'}
Telefone: ${lead.telefone || '-'}
Origem: ${lead.origem || '-'}
Notas: ${lead.notas || '-'}

# ANÁLISE OBRIGATÓRIA (raciocine antes de pontuar)
1. Orçamento provável (baixo / médio / alto / não dá pra inferir)
2. Urgência (quer fechar em 30d / 3m / 12m / pesquisando)
3. Fit com o catálogo da Praia do Rosa (alto / médio / baixo)
4. Sinais de bagunça (telefone vazio, interesse vago, origem suspeita)

RESPONDA EM JSON ESTRITO (nada antes nem depois):
{
  "score": <0-100>,
  "segmento": "<investidor|morar|veranear|urgente|longo_prazo>",
  "tags": ["3 a 5 tags livres do perfil, ex: 'orcamento_alto', 'tem_filhos', 'investidor_sp'"],
  "proxima_acao": "<responder_dm|agendar_call|mandar_proposta|mandar_catalogo|aguardar|arquivar>",
  "justificativa": "<2-3 frases explicando o score, a próxima ação e o que sinalizou bagunça (se houver)>"
}

CALIBRAÇÃO DO SCORE:
- 85-100: orçamento claro + urgência + fit alto → Igor humano agora
- 65-84: 2 dos 3 ok → SDR faz follow-up qualificado
- 40-64: interesse genuíno mas sem urgência → fluxo de nutrição
- 0-39: sinal fraco, ruído ou bagunça → arquivar`;

    const r = await gerarTexto(prompt);
    if (!r) return null;
    const json = extrairJson(r.texto);
    if (!json || typeof json.score === 'undefined') return null;
    return {
        score: Math.max(0, Math.min(100, parseInt(json.score, 10) || 0)),
        segmento: SEGMENTOS.includes(json.segmento) ? json.segmento : null,
        tags: Array.isArray(json.tags) ? json.tags.slice(0, 5).map(t => String(t).slice(0, 40)) : [],
        proxima_acao: PROXIMAS_ACOES.includes(json.proxima_acao) ? json.proxima_acao : null,
        justificativa: json.justificativa || json.motivo || '',
        modelo: r.modelo,
    };
}

module.exports = {
    chave: 'sdr',
    descricao: 'Qualifica leads, faz follow-up e move Kanban',
    tiposAceitos: ['qualificar_lead', 'follow_up', 'boas_vindas'],

    async executar({ tipo, payload }) {
        if (tipo === 'qualificar_lead') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead ${payload.lead_id} não encontrado`);

            const ia = await qualificarComIA(lead);
            const score = ia ? ia.score : Math.min(100, Math.max(0, Math.round(50 + Math.random() * 50)));
            const segmento = ia && ia.segmento;
            const tags = ia && ia.tags && ia.tags.length ? JSON.stringify(ia.tags) : null;
            const novoStatus = score >= 70 ? 'qualificado' : 'novo_lead';

            db.prepare(`
                UPDATE leads SET score_ia = ?, status = ?, segmento = ?, tags_ia = COALESCE(?, tags_ia)
                WHERE id = ?
            `).run(score, novoStatus, segmento, tags, lead.id);

            if (ia) {
                registrarLog({
                    agente: 'sdr', nivel: 'sucesso', template: 'qualificacao',
                    mensagem: `${lead.nome} qualificado: score ${score}, ${segmento || '-'}, ação=${ia.proxima_acao || '-'}`,
                    contexto: { lead_id: lead.id, score, segmento, tags: ia.tags, proxima_acao: ia.proxima_acao, justificativa: ia.justificativa, modelo: ia.modelo }
                });
                // Lead quente (>=85) → push proativo pro Igor humano
                if (score >= 85) {
                    try {
                        const { notificar } = require('../bot');
                        notificar(`*Lead quente — score ${score}*\n\n*${lead.nome}* (${segmento || 'segmento?'})\nInteresse: ${lead.interesse || '-'}\nAção sugerida: \`${ia.proxima_acao || '-'}\`\n\n_${ia.justificativa}_\n\n\`/lead ${lead.id}\` pra detalhe`).catch(() => {});
                    } catch {}

                    // Ação sugerida pela IA dispara skill correspondente automaticamente.
                    // Resultado cai em fila de aprovações pra Levi/Igor humano decidir antes de enviar.
                    try {
                        const { executarSkill } = require('../bot/skills');
                        let skillSlug = null;
                        let inputBase = '';
                        if (ia.proxima_acao === 'mandar_proposta') {
                            skillSlug = 'contratos';
                            inputBase = `Proposta inicial pra lead ${lead.nome}. Interesse: ${lead.interesse || '-'}. Segmento: ${segmento || '-'}. Notas: ${lead.notas || '-'}.`;
                        } else if (ia.proxima_acao === 'mandar_catalogo') {
                            skillSlug = 'pdf';
                            inputBase = `Dossiê com 3-5 imóveis do catálogo que atendem o perfil do lead ${lead.nome}. Interesse: ${lead.interesse || '-'}. Segmento: ${segmento || '-'}.`;
                        }
                        if (skillSlug) {
                            const skillResult = await executarSkill(skillSlug, inputBase, { lead_id: lead.id, lead_nome: lead.nome });
                            if (skillResult.ok) {
                                db.prepare(`
                                    INSERT INTO aprovacoes (agente_destino, tipo, payload, descricao)
                                    VALUES ('sdr', ?, ?, ?)
                                `).run(
                                    `skill_${skillSlug}`,
                                    JSON.stringify({ lead_id: lead.id, output: skillResult.output, skill: skillSlug }),
                                    `${skillSlug.toUpperCase()} para ${lead.nome} (score ${score})`
                                );
                                registrarLog({
                                    agente: 'sdr', nivel: 'sucesso',
                                    mensagem: `Skill ${skillSlug} executada pro lead ${lead.nome} — aprovação criada`,
                                    contexto: { lead_id: lead.id, skill: skillSlug, ms: skillResult.ms }
                                });
                            }
                        }
                    } catch (e) {
                        registrarLog({ agente: 'sdr', nivel: 'alerta', mensagem: `skill auto-disparada falhou: ${e.message}`, contexto: { lead_id: lead.id } });
                    }
                }
            }

            heartbeat('sdr');
            return { lead_id: lead.id, score_ia: score, segmento, tags: ia ? ia.tags : null, proxima_acao: ia ? ia.proxima_acao : null, modo: ia ? 'ia' : 'fallback' };
        }

        if (tipo === 'follow_up') {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(payload.lead_id);
            if (!lead) throw new Error(`Lead ${payload.lead_id} não encontrado`);

            // Gerar mensagem real de follow-up via IA quando disponível
            let mensagem = payload.mensagem;
            if (!mensagem && temAlgumLLM()) {
                const dna = contextoDNA(1500);
                const r = await gerarTexto(`Você é o SDR do Igor Babolin Imóveis (Praia do Rosa - SC). Escreva uma mensagem curta de follow-up (máx 4 linhas) em pt-BR pra reengajar este lead sem soar genérico.

${dna ? `# DNA / TOM DA CASA\n${dna}\n` : ''}
# LEAD
Nome: ${lead.nome}
Interesse: ${lead.interesse || '-'}
Segmento: ${lead.segmento || '-'}
Tags: ${lead.tags_ia || '-'}
Notas: ${lead.notas || '-'}

REGRAS:
- Tom: vendedor de praia, próximo, NÃO corporate. Levi não quer "Olá, tudo bem?" genérico.
- Conecta o follow-up ao interesse declarado dele (não ao seu catálogo aleatório).
- 1 pergunta aberta no final que force resposta de 1 frase.
- ZERO emoji. ZERO "estou à disposição". ZERO "espero seu retorno".

Mensagem (texto puro, sem aspas, sem markdown):`);
                if (r) mensagem = r.texto;
            }

            registrarLog({
                agente: 'sdr', nivel: 'info', template: 'follow_up',
                mensagem: `Follow-up preparado para ${lead.nome}`,
                contexto: { lead_id: lead.id, mensagem: mensagem || '(usar template padrão)' }
            });

            return { lead_id: lead.id, acao: 'follow_up_preparado', mensagem };
        }

        if (tipo === 'boas_vindas') {
            return { acao: 'mensagem_boas_vindas_enviada', destinatario: payload.telefone };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
