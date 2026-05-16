// Dispatcher de linguagem natural: classifica texto livre em uma intent equivalente
// aos slash commands. Devolve { intent, args } pra ser executado pelos mesmos handlers.
// Padrão portado do LMP (maestro-skills).

const { gerarTexto, extrairJson } = require('../agentes/ia');

const INTENTS_DISPONIVEIS = [
    'status', 'leads', 'lead', 'pendentes', 'aprovar', 'rejeitar',
    'imoveis', 'imovel', 'briefing', 'log', 'agenda', 'timeline',
    'ajuda', 'conversa'
];

const PROMPT_SISTEMA = `Você classifica mensagens em português que o Levi/Igor manda pro bot do sistema neural Igor Babolin (imobiliária Praia do Rosa).

Intents disponíveis:
- status — pergunta geral sobre o estado do sistema ("como tá?", "tudo certo?")
- leads — listar leads (opcional filtro por palavra: nome, status, segmento)
- lead — detalhe de UM lead específico (precisa de id, ex: "lead_seed_3")
- pendentes — listar aprovações pendentes
- aprovar — aprovar uma aprovação específica (precisa id numérico)
- rejeitar — rejeitar uma aprovação (precisa id + motivo opcional)
- imoveis — buscar no catálogo (filtro por tipo, bairro, palavra)
- imovel — detalhe de UM imóvel (precisa id ou slug)
- briefing — disparar o briefing matinal manual
- log — últimos logs (opcional filtro por agente: sdr, social, designer, pesquisa, etc)
- agenda — próximos eventos
- timeline — timeline de UM lead (precisa id)
- ajuda — pedido de ajuda, menu, lista comandos
- conversa — bate-papo geral, pergunta aberta, qualquer coisa que não cabe acima

REGRAS:
- Responda APENAS em JSON, sem texto antes nem depois.
- Múltiplas intents na mesma mensagem? Devolva array em "intents".
- Se houver argumento (id, filtro, palavra-chave), inclua em "args" como string.
- Sem certeza? Vá pra "conversa".

EXEMPLOS:
"Como tá o sistema?" → {"intent":"status"}
"Lista os leads novos" → {"intent":"leads","args":"novo_lead"}
"Pega o lead Ricardo" → {"intent":"leads","args":"ricardo"}
"detalhe do lead_seed_3" → {"intent":"lead","args":"lead_seed_3"}
"aprovar 42" → {"intent":"aprovar","args":"42"}
"tem casa em ibiraquera?" → {"intent":"imoveis","args":"ibiraquera"}
"manda o briefing" → {"intent":"briefing"}
"o que rodou hoje no designer" → {"intent":"log","args":"designer"}
"qual a agenda?" → {"intent":"agenda"}
"status e leads novos" → {"intents":[{"intent":"status"},{"intent":"leads","args":"novo_lead"}]}
"oi, beleza?" → {"intent":"conversa"}`;

async function classificar(texto) {
    if (!texto || typeof texto !== 'string') return [{ intent: 'conversa', args: '' }];

    const r = await gerarTexto(`${PROMPT_SISTEMA}\n\nMENSAGEM: ${texto}\n\nJSON:`);
    if (!r) return [{ intent: 'conversa', args: '' }];

    const json = extrairJson(r.texto);
    if (!json) return [{ intent: 'conversa', args: '' }];

    let lista = [];
    if (Array.isArray(json.intents)) {
        lista = json.intents;
    } else if (json.intent) {
        lista = [json];
    } else {
        return [{ intent: 'conversa', args: '' }];
    }

    return lista
        .filter(i => INTENTS_DISPONIVEIS.includes(i.intent))
        .map(i => ({ intent: i.intent, args: String(i.args || '').slice(0, 200) }));
}

module.exports = { classificar, INTENTS_DISPONIVEIS };
