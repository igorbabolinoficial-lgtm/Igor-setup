// Mídia Paga — Meta Ads e Google Ads. Hoje: gera estrutura de campanha + relatório (sem API ainda).
// API Meta/Google entra quando Levi conectar as contas.

const { db, registrarLog } = require('../db');
const { gerarTexto, temAlgumLLM, extrairJson } = require('./ia');
const { heartbeat } = require('./base');
let contextoDNA = () => '';
try { ({ contextoDNA } = require('../routes/cerebro')); } catch (_) {}

module.exports = {
    chave: 'midia_paga',
    descricao: 'Meta Ads + Google Ads (estrutura, segmentação, relatórios)',
    tiposAceitos: ['criar_campanha', 'otimizar_ads', 'relatorio_ads'],

    async executar({ tipo, payload }) {
        const dna = contextoDNA(1200);

        if (tipo === 'criar_campanha') {
            if (!temAlgumLLM()) return { estrutura: 'Sem LLM' };
            const imovel = payload.imovel_id ? db.prepare('SELECT * FROM imoveis WHERE id = ?').get(payload.imovel_id) : null;
            const orcamento = payload.orcamento_diario || 50;
            const objetivo = payload.objetivo || 'conversao_leads';

            const prompt = `Você é o Mídia Paga do Igor Babolin (Praia do Rosa - SC). Crie estrutura de campanha META ADS pra:

${imovel ? `Imóvel: ${imovel.titulo} (${imovel.tipo}, ${imovel.bairro}) — R$ ${imovel.preco}` : `Tema: ${payload.tema || 'genérico'}`}
Objetivo: ${objetivo}
Orçamento: R$ ${orcamento}/dia

${dna}

Devolva JSON estrito:
{
  "campanha": {"nome":"...", "objetivo_meta":"OUTCOME_LEADS|TRAFFIC|...", "orcamento_diario": ${orcamento}},
  "publicos": [
    {"nome":"...", "criterios": {"idade":"30-65","localizacao":"SP+SC+RS","interesses":["..."],"comportamentos":["..."]}}
  ],
  "criativos": [
    {"tipo":"reel|imagem|carrossel","hook":"...","cta":"..."}
  ],
  "metricas_alvo": {"cpl":"...","ctr":"..."}
}`;
            const r = await gerarTexto(prompt);
            const json = r ? extrairJson(r.texto) : null;
            heartbeat('midia_paga');
            registrarLog({ agente: 'midia_paga', nivel: 'sucesso', mensagem: `Campanha estruturada${imovel ? ` pro imóvel ${imovel.titulo}` : ''}`, contexto: { imovel_id: imovel?.id, orcamento } });
            return { estrutura: json || { raw: r?.texto?.slice(0, 500) }, modelo: r?.modelo };
        }

        if (tipo === 'otimizar_ads') {
            // Hoje: sem API Meta. Recebe métricas via payload e sugere ajustes.
            if (!temAlgumLLM()) return { recomendacoes: 'Sem LLM' };
            const prompt = `Você é o Mídia Paga do Igor Babolin. Analise métricas e sugira 3 ações concretas pra otimizar.

${dna}

# MÉTRICAS DA CAMPANHA
${JSON.stringify(payload.metricas || {}, null, 2)}

Recomendações (numeradas, ação direta):`;
            const r = await gerarTexto(prompt);
            heartbeat('midia_paga');
            return { recomendacoes: r?.texto, modelo: r?.modelo };
        }

        if (tipo === 'relatorio_ads') {
            // Dispara skill xlsx pra gerar relatório em formato planilha
            const { executarSkill } = require('../bot/skills');
            const periodo = payload.periodo || '7d';
            const r = await executarSkill('xlsx', `Relatório de performance Meta Ads — ${periodo}. Métricas: ${JSON.stringify(payload.metricas || {})}`, payload);
            heartbeat('midia_paga');
            return { relatorio: r.output };
        }

        throw new Error(`Tipo desconhecido: ${tipo}`);
    }
};
