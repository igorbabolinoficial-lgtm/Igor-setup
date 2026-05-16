// Proatividade autônoma do Igor — roda independente das APIs externas.
// Mantém o sistema produtivo (pesquisando, criando, treinando) mesmo sem leads chegando.
const cron = require('node-cron');
const { db, uid, nowIso, registrarLog } = require('../db');
const { enfileirar } = require('./maestro');
const { heartbeat } = require('./base');
const { gerarTexto, extrairJson, temAlgumLLM } = require('./ia');
let registrarSinapse;
let contextoDNA = () => '';
try { ({ registrarSinapse, contextoDNA } = require('../routes/cerebro')); } catch (_) {}

// ───────────────────────── 1) Pesquisa autônoma (cron a cada hora) ─────────────────────────
function pesquisaAutonoma() {
    const stats = db.prepare(`
        SELECT COUNT(*) AS total,
               AVG(preco) AS preco_medio,
               MIN(preco) AS minimo,
               MAX(preco) AS maximo
        FROM imoveis WHERE preco > 0
    `).get();
    const porTipo = db.prepare(`SELECT tipo, COUNT(*) AS n FROM imoveis GROUP BY tipo ORDER BY n DESC`).all();
    const porBairro = db.prepare(`SELECT bairro, COUNT(*) AS n FROM imoveis WHERE bairro IS NOT NULL GROUP BY bairro ORDER BY n DESC LIMIT 5`).all();
    const top3 = db.prepare(`SELECT titulo, preco, tipo, bairro FROM imoveis WHERE preco > 0 ORDER BY preco DESC LIMIT 3`).all();
    const baratos3 = db.prepare(`SELECT titulo, preco, tipo, bairro FROM imoveis WHERE preco > 0 ORDER BY preco ASC LIMIT 3`).all();

    const fmtBRL = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` : '-';

    const conteudo = [
        `## Snapshot de mercado — ${new Date().toLocaleString('pt-BR')}`,
        ``,
        `**Catálogo:** ${stats.total} imóveis com preço`,
        `**Ticket médio:** ${fmtBRL(stats.preco_medio)}`,
        `**Faixa:** ${fmtBRL(stats.minimo)} → ${fmtBRL(stats.maximo)}`,
        ``,
        `### Distribuição por tipo`,
        ...porTipo.map(t => `- ${t.tipo || 'sem_tipo'}: ${t.n}`),
        ``,
        `### Top 5 bairros`,
        ...porBairro.map(b => `- ${b.bairro}: ${b.n}`),
        ``,
        `### Top 3 mais caros`,
        ...top3.map(i => `- ${fmtBRL(i.preco)} — ${i.titulo} (${i.tipo || '-'} / ${i.bairro || '-'})`),
        ``,
        `### Top 3 entrada (mais baratos)`,
        ...baratos3.map(i => `- ${fmtBRL(i.preco)} — ${i.titulo} (${i.tipo || '-'} / ${i.bairro || '-'})`)
    ].join('\n');

    if (registrarSinapse) {
        try {
            registrarSinapse({
                titulo: `Pesquisa de Mercado — ${new Date().toISOString().slice(0, 13)}h`,
                tipo: 'pesquisa',
                conteudo,
                conectaCom: ['Igor_Babolin', 'Agente_Pesquisa'],
                pasta: 'Logs_Neurais'
            });
        } catch (_) {}
    }

    heartbeat('pesquisa');
    registrarLog({
        agente: 'pesquisa', nivel: 'info',
        mensagem: 'Snapshot de mercado registrado no Cérebro',
        contexto: { total_imoveis: stats.total, preco_medio: Math.round(stats.preco_medio || 0) }
    });
}

// ───────────────────────── 2) Designer pré-produzindo criativos ─────────────────────────
// Para cada imóvel: gera/atualiza criativo conectando a hubs de Tipo e Bairro
// (forma clusters naturais no grafo do Obsidian em vez de pontos soltos).
function normalizarHub(s) {
    if (!s) return null;
    return s.trim().replace(/\s+/g, '_').replace(/[^\w-áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, '');
}

function garantirHub(base, fs, path, pasta, nomeArquivo, titulo, tipoHub, descricao) {
    const dir = path.join(base, pasta);
    fs.mkdirSync(dir, { recursive: true });
    const arquivo = path.join(dir, `${nomeArquivo}.md`);
    // Hubs sempre regeneram (são curadoria automática, sem edição manual prevista)
    const md = `---
projeto: Igor_Babolin
tipo: ${tipoHub}
data: ${new Date().toISOString().slice(0, 10)}
conecta_com:
  - [[Igor_Babolin]] # Hub_de
---

# ${titulo}

${descricao}

---

## 🔗 Conexões
- Faz parte de: [[Igor_Babolin]]
- Curado por: [[Agente_Designer]] e [[Agente_Pesquisa]]

> Hub gerado automaticamente. Todas as notas com este tipo/bairro se conectam aqui.
`;
    fs.writeFileSync(arquivo, md, 'utf8');
}

async function copyIAImovel(im) {
    if (!temAlgumLLM()) return null;
    const dna = contextoDNA(1800);
    const prompt = `Você é o copywriter sênior da imobiliária Igor Babolin (Praia do Rosa - SC). Produz material que vende SEM clichê de corretor.

${dna ? `# DNA DA CASA (do Cérebro Obsidian)\n${dna}\n` : ''}
# IMÓVEL
Título: ${im.titulo}
Tipo: ${im.tipo || '-'} · Bairro: ${im.bairro || 'Praia do Rosa'} · Preço: ${im.preco ? 'R$ ' + Number(im.preco).toLocaleString('pt-BR') : 'sob consulta'}
${im.quartos ? 'Quartos: ' + im.quartos + ' · ' : ''}${im.area_m2 ? 'Área: ' + im.area_m2 + 'm²' : ''}
${im.descricao ? 'Detalhes: ' + im.descricao.slice(0, 400) : ''}

# REGRAS
- Headline Instagram: observação concreta (lugar, número, sensação). NÃO usar "Conheça", "Apresentando", "Imperdível", "Cantinho do paraíso".
- Copy DM: 2-3 linhas, próximo, sem "Olá, tudo bem?" genérico. Pergunta concreta no fim.
- Copy post: 4-6 parágrafos curtos. Hook nas 2 primeiras linhas. Diferencial específico deste imóvel (não template).
- Carrossel: 5 slides distintos. Cada slide = 1 ideia única.
- Hashtags: 6 relevantes, misturando localidade (PraiaDoRosa, Imbituba, Garopaba) + tipo + estilo.
- Máximo 3 emojis no post inteiro. Zero emojis na DM.

RESPONDA EM JSON ESTRITO (nada antes nem depois):
{
  "headline_ig": "máx 80 chars",
  "copy_dm": "2-3 linhas",
  "copy_post": "post completo com \\n\\n entre parágrafos",
  "carrossel": ["slide 1: ...", "slide 2: ...", "slide 3: ...", "slide 4: ...", "slide 5: ..."],
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6"]
}`;
    const r = await gerarTexto(prompt);
    if (!r) return null;
    return extrairJson(r.texto);
}

async function designerPreproducao() {
    const path = require('path');
    const fs = require('fs');
    const base = process.env.OBSIDIAN_PATH;
    if (!base || !fs.existsSync(base)) return;

    const dir = path.join(base, 'Agentes', 'Designer', 'criativos');
    fs.mkdirSync(dir, { recursive: true });

    const imoveis = db.prepare(`
        SELECT id, slug, titulo, preco, tipo, bairro, quartos, banheiros, area_m2, descricao
        FROM imoveis ORDER BY importado_em DESC LIMIT 28
    `).all();

    // 1) Coletar tipos e bairros únicos pra criar hubs
    const tipos = new Set();
    const bairros = new Set();
    for (const im of imoveis) {
        if (im.tipo)   tipos.add(im.tipo);
        if (im.bairro) bairros.add(im.bairro);
    }

    // 2) Criar hub files (idempotente)
    for (const t of tipos) {
        const hub = `Tipo_${normalizarHub(t)}`;
        garantirHub(base, fs, path, '10_Estrategia/Tipos', hub, hub.replace(/_/g, ' '), 'hub_tipo',
            `Hub para todos os imóveis do tipo **${t}**. Conecta criativos, pesquisas e leads.`);
    }
    for (const b of bairros) {
        const hub = `Bairro_${normalizarHub(b)}`;
        garantirHub(base, fs, path, '10_Estrategia/Bairros', hub, hub.replace(/_/g, ' '), 'hub_bairro',
            `Hub para imóveis no bairro **${b}**. Conecta criativos, leads interessados e dados de mercado.`);
    }

    // 3) Gerar/atualizar criativos com links pros hubs (e copy real via IA quando disponível)
    let total = 0;
    let comIA = 0;
    for (const im of imoveis) {
        const arquivo = path.join(dir, `${im.slug}.md`);

        const fmtBRL = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` : 'sob consulta';
        const headlineFallback = `${im.tipo || 'Imóvel'}${im.quartos ? ' ' + im.quartos + 'Q' : ''}${im.bairro ? ' em ' + im.bairro : ''}`;

        const sinapses = ['  - [[Igor_Babolin]] # Criativo_de', '  - [[Agente_Designer]] # Produzido_por'];
        if (im.tipo)   sinapses.push(`  - [[Tipo_${normalizarHub(im.tipo)}]] # Eh_do_tipo`);
        if (im.bairro) sinapses.push(`  - [[Bairro_${normalizarHub(im.bairro)}]] # Localizado_em`);

        // Tentar copy real via IA (cara — só re-gera se não existe ou se forçar)
        const jaTem = fs.existsSync(arquivo);
        const conteudoExistente = jaTem ? fs.readFileSync(arquivo, 'utf8') : '';
        const jaTemIA = conteudoExistente.includes('status: rascunho_ia');

        let copyIA = null;
        if (!jaTemIA) {
            try { copyIA = await copyIAImovel(im); } catch (_) {}
            if (copyIA) comIA++;
        }

        const headlineIG = (copyIA && copyIA.headline_ig) || `${headlineFallback} por ${fmtBRL(im.preco)} — Praia do Rosa te espera. 🌊`;
        const copyDM = (copyIA && copyIA.copy_dm) || `Oi! Vi que você tem interesse na Praia do Rosa. Acabou de chegar este ${im.tipo || 'imóvel'}${im.bairro ? ' em ' + im.bairro : ''} por ${fmtBRL(im.preco)}. Posso te mandar mais fotos?`;
        const copyPost = (copyIA && copyIA.copy_post) || (im.descricao ? im.descricao.slice(0, 400) : 'Imóvel selecionado pelo Igor para o seu perfil.');
        const carrossel = (copyIA && Array.isArray(copyIA.carrossel) && copyIA.carrossel.length)
            ? copyIA.carrossel.map((s, i) => `${i + 1}. ${s}`).join('\n')
            : `1. Foto principal + headline\n2. Diferenciais\n3. Planta\n4. Bairro: ${im.bairro || '-'}\n5. CTA: "Comenta EU"`;
        const hashtags = (copyIA && Array.isArray(copyIA.hashtags) && copyIA.hashtags.length)
            ? copyIA.hashtags.join(' ')
            : `#PraiaDoRosa #ImoveisPraiaDoRosa #${(im.tipo || 'imovel').toLowerCase()} #BabolinImoveis`;

        const status = copyIA ? 'rascunho_ia' : (jaTemIA ? 'rascunho_ia' : 'rascunho_fallback');

        const conteudo = `---
projeto: Igor_Babolin
tipo: criativo
imovel_id: ${im.id}
imovel_tipo: ${im.tipo || '-'}
imovel_bairro: ${im.bairro || '-'}
data: ${new Date().toISOString().slice(0, 10)}
status: ${status}
conecta_com:
${sinapses.join('\n')}
---

# Criativo — ${im.titulo}

**Imóvel:** ${headlineFallback}
**Preço:** ${fmtBRL(im.preco)}
${im.area_m2 ? `**Área:** ${im.area_m2} m²` : ''}

## Headline (Instagram)
> ${headlineIG}

## Copy curta (DM / WhatsApp)
${copyDM}

## Copy longa (post / carrossel)
${copyPost}

## Carrossel sugerido (5 slides)
${carrossel}

## Hashtags
${hashtags}

---

## 🔗 Conexões
- Hub central: [[Igor_Babolin]]
- Agente: [[Agente_Designer]]
${im.tipo   ? `- Tipo: [[Tipo_${normalizarHub(im.tipo)}]]`     : ''}
${im.bairro ? `- Bairro: [[Bairro_${normalizarHub(im.bairro)}]]` : ''}

*Aguardando aprovação humana antes de publicar. Editado por Designer Igor.*
`;
        fs.writeFileSync(arquivo, conteudo, 'utf8');
        total++;
    }

    heartbeat('designer');
    registrarLog({
        agente: 'designer', nivel: 'sucesso',
        mensagem: `Designer atualizou ${total} criativos (${comIA} com copy IA real)`,
        contexto: { criativos: total, com_ia: comIA, tipos: [...tipos], bairros: [...bairros] }
    });
}

// ───────────────────────── 3) Social pré-agendando 30 dias ─────────────────────────
function socialPreAgendamento() {
    const HORARIOS = ['10:00', '15:00', '19:00']; // 3 posts/dia
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

    let agendados = 0;
    for (let d = 0; d < 30; d++) {
        const dia = new Date(hoje); dia.setDate(dia.getDate() + d);
        const ymd = dia.toISOString().slice(0, 10);

        const existentes = db.prepare(`
            SELECT COUNT(*) AS n FROM agenda WHERE tipo = 'post' AND DATE(inicio) = ?
        `).get(ymd).n;

        if (existentes >= HORARIOS.length) continue;

        // Sortear imóveis pra rotacionar conteúdo
        const imoveis = db.prepare(`SELECT id, titulo, tipo, bairro FROM imoveis ORDER BY RANDOM() LIMIT ?`).all(HORARIOS.length);

        for (let h = existentes; h < HORARIOS.length; h++) {
            const [hh, mm] = HORARIOS[h].split(':');
            const quando = new Date(dia); quando.setHours(Number(hh), Number(mm), 0, 0);
            const im = imoveis[h] || imoveis[0];
            if (!im) break;

            const id = uid('evt');
            db.prepare(`
                INSERT INTO agenda (id, titulo, descricao, inicio, tipo, status)
                VALUES (?, ?, ?, ?, 'post', 'agendado')
            `).run(
                id,
                `Post: ${im.titulo}`,
                `Auto-pré-agendado pelo Social Igor. Imóvel ${im.id}. Horário ${HORARIOS[h]}. Aguarda revisão antes da publicação real.`,
                quando.toISOString()
            );
            agendados++;
        }
    }

    heartbeat('social');
    if (agendados > 0) {
        registrarLog({
            agente: 'social', nivel: 'sucesso',
            mensagem: `Social pré-agendou ${agendados} posts pros próximos 30 dias`,
            contexto: { agendados, horarios: HORARIOS }
        });
    }
}

// ───────────────────────── 4) Modo treino — leads sintéticos ─────────────────────────
const PERSONAS_TREINO = [
    { nome: 'Treino — Investidor SP',         interesse: 'Apartamento short-stay 2Q vista mar',                 origem: 'treino' },
    { nome: 'Treino — Família curitibana',    interesse: 'Casa 4 quartos Ibiraquera, próxima de escola',         origem: 'treino' },
    { nome: 'Treino — Casal aposentado',      interesse: 'Sobrado tranquilo Rosa Norte até R$ 1,2M',             origem: 'treino' },
    { nome: 'Treino — Surfista alemão',       interesse: 'Loft próximo ao pico do Silveira, anual ou venda',    origem: 'treino' },
    { nome: 'Treino — Empresário gaúcho',     interesse: 'Cobertura beira-mar, 3+ suítes, piscina',              origem: 'treino' },
    { nome: 'Treino — Construtora pequena',   interesse: 'Terreno 800m² para construir 4 unidades',              origem: 'treino' },
    { nome: 'Treino — Família catarinense',   interesse: 'Casa de praia para finais de semana, até R$ 800k',     origem: 'treino' }
];

function leadSintetico() {
    // Limita a 5 leads de treino ativos pra não inundar o Kanban
    const ativos = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE origem = 'treino' AND status NOT IN ('convertido', 'perdido')`).get().n;
    if (ativos >= 5) return;

    const persona = PERSONAS_TREINO[Math.floor(Math.random() * PERSONAS_TREINO.length)];
    const id = uid('lead_treino');
    db.prepare(`
        INSERT INTO leads (id, nome, interesse, telefone, origem, status, score_ia, notas)
        VALUES (?, ?, ?, ?, 'treino', 'novo_lead', 0, 'Lead sintético gerado pro modo treino. NÃO enviar mensagens reais.')
    `).run(id, persona.nome, persona.interesse, '+5500000000000');

    heartbeat('maestro');
    registrarLog({
        agente: 'maestro', nivel: 'info',
        mensagem: `Modo treino: gerou lead-fantasma "${persona.nome}"`,
        contexto: { lead_id: id, persona }
    });
}

// ───────────────────────── 5) Relatório semanal (segunda 07:30) ─────────────────────────
async function relatorioSemanal() {
    const fs = require('fs');
    const path = require('path');
    const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const novosLeads      = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE criado_em >= ? AND origem != 'treino'`).get(desde).n;
    const conversoes      = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE status = 'convertido' AND atualizado_em >= ? AND origem != 'treino'`).get(desde).n;
    const tarefasOk       = db.prepare(`SELECT COUNT(*) AS n FROM fila_tarefas WHERE status = 'concluida' AND concluido_em >= ?`).get(desde).n;
    const tarefasErr      = db.prepare(`SELECT COUNT(*) AS n FROM fila_tarefas WHERE status = 'falhou' AND concluido_em >= ?`).get(desde).n;
    const aprovDecididas  = db.prepare(`SELECT COUNT(*) AS n FROM aprovacoes WHERE decidido_em >= ?`).get(desde).n;
    const aprovPendentes  = db.prepare(`SELECT COUNT(*) AS n FROM aprovacoes WHERE status = 'pendente'`).get().n;
    const postsAgendados  = db.prepare(`SELECT COUNT(*) AS n FROM agenda WHERE tipo = 'post' AND criado_em >= ?`).get(desde).n;
    const porSegmento     = db.prepare(`SELECT segmento, COUNT(*) AS n FROM leads WHERE origem != 'treino' AND segmento IS NOT NULL GROUP BY segmento`).all();
    const topLeads        = db.prepare(`SELECT nome, score_ia, segmento FROM leads WHERE origem != 'treino' AND status NOT IN ('convertido','perdido') ORDER BY score_ia DESC LIMIT 5`).all();

    // Estimativa de horas economizadas (heurística): 5min/tarefa automatizada + 15min/post pré-agendado + 10min/aprovação
    const horasEconomizadas = ((tarefasOk * 5) + (postsAgendados * 15) + (aprovDecididas * 10)) / 60;

    const metricas = `
- Novos leads (7d): ${novosLeads}
- Conversões (7d): ${conversoes}
- Tarefas executadas: ${tarefasOk} ok / ${tarefasErr} falhas
- Aprovações: ${aprovDecididas} decididas | ${aprovPendentes} pendentes
- Posts pré-agendados: ${postsAgendados}
- Horas humanas economizadas (estimativa): ~${horasEconomizadas.toFixed(1)}h
- Distribuição por segmento: ${porSegmento.map(s => `${s.segmento}=${s.n}`).join(', ') || 'sem dados'}
- Top 5 leads ativos: ${topLeads.map(l => `${l.nome}(${l.score_ia}/${l.segmento || '-'})`).join(', ') || 'nenhum'}`;

    let analise = '';
    if (temAlgumLLM()) {
        const r = await gerarTexto(`Você é o Igor, IA da imobiliária Igor Babolin (Praia do Rosa - SC). Escreva o relatório semanal pro proprietário em pt-BR baseado nas métricas abaixo. Estrutura:

## 🎯 Resumo executivo
2-3 frases sobre o que aconteceu

## 📈 O que funcionou
2-3 bullets

## ⚠️ Atenção
2-3 bullets

## 🚀 Plano da próxima semana
3 ações priorizadas

MÉTRICAS: ${metricas}

Seja direto, sem clichê de consultoria.`);
        if (r) analise = r.texto;
    }

    const conteudo = `# Relatório Semanal — ${new Date().toLocaleDateString('pt-BR')}

## 📊 Métricas
${metricas}

${analise || '_Configure GEMINI_API_KEY ou ANTHROPIC_API_KEY pra Igor escrever a análise da semana._'}

---

## 🔗 Conexões
- Hub: [[Igor_Babolin]]
- Tipo: relatorio_semanal
`;

    if (registrarSinapse) {
        try {
            registrarSinapse({
                titulo: `Relatorio_Semanal_${new Date().toISOString().slice(0, 10)}`,
                tipo: 'relatorio_semanal',
                conteudo,
                conectaCom: ['Igor_Babolin'],
                pasta: 'Briefings/Semanal'
            });
        } catch (_) {}
    }

    heartbeat('maestro');
    registrarLog({
        agente: 'maestro', nivel: 'sucesso',
        mensagem: `Relatório semanal gerado (${horasEconomizadas.toFixed(1)}h economizadas)`,
        contexto: { novosLeads, conversoes, tarefasOk, postsAgendados, horas_economizadas: horasEconomizadas }
    });

    // Push proativo do relatório semanal pro Telegram
    try {
        const { notificar } = require('../bot');
        notificar(`*Relatório semanal — ${new Date().toLocaleDateString('pt-BR')}*\n\nNovos leads: ${novosLeads} · Conversões: ${conversoes}\nHoras economizadas: ~${horasEconomizadas.toFixed(1)}h\nAprovações pendentes: ${aprovPendentes}\n\nVer detalhes no vault Obsidian.`).catch(() => {});
    } catch {}
}

// ───────────────────────── 6) Backup diário do banco ─────────────────────────
function backupDiario() {
    const fs = require('fs');
    const path = require('path');
    const base = process.env.OBSIDIAN_PATH;
    if (!base || !fs.existsSync(base)) return;

    const dirBackup = path.join(base, '00_Backups');
    fs.mkdirSync(dirBackup, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(dirBackup, `igor.db.${stamp}.bak`);
    const src = path.join(__dirname, '..', 'igor.db');

    try {
        fs.copyFileSync(src, dest);
    } catch (err) {
        registrarLog({ agente: 'sistema', nivel: 'erro', mensagem: `Backup falhou: ${err.message}` });
        return;
    }

    // Retenção: 14 dias
    const limite = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let removidos = 0;
    for (const f of fs.readdirSync(dirBackup)) {
        if (!f.startsWith('igor.db.') || !f.endsWith('.bak')) continue;
        const completo = path.join(dirBackup, f);
        try {
            const stat = fs.statSync(completo);
            if (stat.mtimeMs < limite) { fs.unlinkSync(completo); removidos++; }
        } catch (_) {}
    }

    heartbeat('maestro');
    registrarLog({
        agente: 'sistema', nivel: 'sucesso',
        mensagem: `Backup do banco salvo no vault (${removidos} antigos removidos)`,
        contexto: { destino: dest, retencao_dias: 14 }
    });
}

// ───────────────────────── 7) TTL de aprovações pendentes (7 dias) ─────────────────────────
function expirarAprovacoes() {
    const limite = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const r = db.prepare(`
        UPDATE aprovacoes SET status = 'expirada', expirada_em = ?
        WHERE status = 'pendente' AND criado_em < ?
    `).run(nowIso(), limite);
    if (r.changes > 0) {
        registrarLog({
            agente: 'maestro', nivel: 'alerta',
            mensagem: `${r.changes} aprovações expiradas (>7d sem decisão)`,
            contexto: { expiradas: r.changes }
        });
        // Push proativo de expiração — Igor humano precisa decidir antes de virar lixo
        try {
            const { notificar } = require('../bot');
            notificar(`*Atenção:* ${r.changes} aprovação(ões) expirou por mais de 7 dias sem decisão. Verifique \`/pendentes\` no bot ou no dashboard.`).catch(() => {});
        } catch {}
    }
    heartbeat('maestro');

    // Lembrete de aprovações pendentes há >24h (não expiradas ainda, mas envelhecidas)
    const envelhecidas = db.prepare(`
        SELECT id, tipo, agente_destino FROM aprovacoes
        WHERE status = 'pendente' AND criado_em < datetime('now', '-24 hours')
        LIMIT 5
    `).all();
    if (envelhecidas.length > 0) {
        // Só notifica 1x por dia — usa config table como flag
        const hoje = new Date().toISOString().slice(0, 10);
        const last = db.prepare("SELECT valor FROM config WHERE chave = 'last_envelhecidas_notif'").get();
        if (!last || last.valor !== hoje) {
            try {
                const { notificar } = require('../bot');
                const linhas = envelhecidas.map(a => `· \`${a.id}\` ${a.tipo} (${a.agente_destino})`).join('\n');
                notificar(`*${envelhecidas.length} aprovação(ões) há >24h aguardando*\n\n${linhas}\n\n\`/aprovar <id>\` ou \`/rejeitar <id>\``).catch(() => {});
                db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('last_envelhecidas_notif', ?)").run(hoje);
            } catch {}
        }
    }
}

// ───────────────────────── Inicializador ─────────────────────────
function iniciar() {
    // 1) Pesquisa autônoma — toda hora cheia
    cron.schedule('0 * * * *', pesquisaAutonoma);
    // 2) Designer pré-produção — uma vez por dia 06:30
    cron.schedule('30 6 * * *', designerPreproducao);
    // 3) Social pré-agendamento — uma vez por dia 06:00
    cron.schedule('0 6 * * *', socialPreAgendamento);
    // 4) Modo treino — a cada 6h, 60% de chance
    cron.schedule('0 */6 * * *', () => { if (Math.random() < 0.6) leadSintetico(); });
    // 5) Relatório semanal — toda segunda 07:30
    cron.schedule('30 7 * * 1', relatorioSemanal);
    // 6) Backup diário — 02:00
    cron.schedule('0 2 * * *', backupDiario);
    // 7) TTL aprovações — toda hora
    cron.schedule('15 * * * *', expirarAprovacoes);

    // Bootstrap imediato (não esperar o próximo cron pra primeira execução)
    setTimeout(async () => {
        try { pesquisaAutonoma(); } catch (e) { registrarLog({ agente: 'pesquisa', nivel: 'erro', mensagem: e.message }); }
        try { await designerPreproducao(); } catch (e) { registrarLog({ agente: 'designer', nivel: 'erro', mensagem: e.message }); }
        try { socialPreAgendamento(); } catch (e) { registrarLog({ agente: 'social', nivel: 'erro', mensagem: e.message }); }
        try { leadSintetico(); } catch (e) { registrarLog({ agente: 'maestro', nivel: 'erro', mensagem: e.message }); }
        try { backupDiario(); } catch (e) { registrarLog({ agente: 'sistema', nivel: 'erro', mensagem: e.message }); }
        try { expirarAprovacoes(); } catch (e) { registrarLog({ agente: 'sistema', nivel: 'erro', mensagem: e.message }); }
    }, 3000);

    registrarLog({
        agente: 'sistema', nivel: 'sucesso',
        mensagem: 'Proatividade ativa: Pesquisa 1h • Designer 06:30 • Social 06:00 • Treino 6h • Relatório seg 07:30 • Backup 02:00 • TTL aprovações 1h'
    });
}

module.exports = { iniciar, pesquisaAutonoma, designerPreproducao, socialPreAgendamento, leadSintetico, relatorioSemanal, backupDiario, expirarAprovacoes };
