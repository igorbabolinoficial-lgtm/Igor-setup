const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Em prod (Coolify), DB_PATH aponta pra /data/igor.db (volume persistente).
// Em dev, fallback pra ./igor.db na raiz do projeto.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'igor.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Garante que o diretório do banco existe (importante pra volume novo /data vazio)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// === Migrações idempotentes (colunas novas em tabelas existentes) ===
function colunaExiste(tabela, coluna) {
    return db.prepare(`PRAGMA table_info(${tabela})`).all().some(c => c.name === coluna);
}
function adicionarColuna(tabela, coluna, defSql) {
    if (!colunaExiste(tabela, coluna)) {
        db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${defSql}`);
    }
}
adicionarColuna('leads', 'tags_ia', 'TEXT');                   // JSON array de tags atribuídas pela IA
adicionarColuna('leads', 'segmento', 'TEXT');                  // segmento principal: investidor / morar / veranear / urgente / longo_prazo
adicionarColuna('aprovacoes', 'expirada_em', 'TEXT');          // marca quando o TTL atingiu
adicionarColuna('leads', 'arquivado', 'INTEGER DEFAULT 0');    // soft-delete pra esconder sem perder histórico
adicionarColuna('agenda', 'google_event_id', 'TEXT');          // id do evento no Google Calendar (best-effort sync)
adicionarColuna('agenda', 'google_event_link', 'TEXT');        // htmlLink do Calendar
adicionarColuna('agenda', 'google_meet_link', 'TEXT');         // hangoutLink (Meet) gerado automaticamente

// === Campos enriquecidos de imóveis (v2) ===
adicionarColuna('imoveis', 'suites',           'INTEGER');                       // suítes (subset de quartos)
adicionarColuna('imoveis', 'garagem',          'INTEGER');                       // vagas de garagem
adicionarColuna('imoveis', 'area_terreno_m2',  'REAL');                          // área total do terreno
adicionarColuna('imoveis', 'negocio',          'TEXT DEFAULT \'venda\'');        // venda | locacao | temporada | permuta
adicionarColuna('imoveis', 'forma_pagamento',  'TEXT');                          // JSON array: ["financiamento","fgts","avista","permuta"]
adicionarColuna('imoveis', 'iptu_anual',       'REAL');                          // R$ IPTU/ano
adicionarColuna('imoveis', 'condominio_mensal','REAL');                          // R$ condomínio/mês
adicionarColuna('imoveis', 'aceita_fgts',      'INTEGER DEFAULT 0');             // 0=não/desconhecido 1=sim
adicionarColuna('imoveis', 'codigo_ref',       'TEXT');                          // código de referência do imóvel
adicionarColuna('imoveis', 'caracteristicas',  'TEXT');                          // JSON array: ["piscina","vista mar",...]

// === Seed dos 6 novos agentes (Consultores + Marketing expandido) ===
// Idempotente: INSERT OR IGNORE não duplica se a chave já existe
db.prepare(`INSERT OR IGNORE INTO agentes (chave, nome, descricao, tipos_aceitos) VALUES (?, ?, ?, ?)`).run(
    'closer', 'Closer', 'Fecha leads quentes (score >=65): proposta, agenda visita, negociação.', 'mandar_proposta,agendar_visita,negociar'
);
db.prepare(`INSERT OR IGNORE INTO agentes (chave, nome, descricao, tipos_aceitos) VALUES (?, ?, ?, ?)`).run(
    'account_manager', 'Account Manager', 'Pós-venda: lembretes de contrato, NPS, up-sell, suporte ao cliente convertido.', 'lembrete_contrato,nps,upsell,suporte_pos'
);
db.prepare(`INSERT OR IGNORE INTO agentes (chave, nome, descricao, tipos_aceitos) VALUES (?, ?, ?, ?)`).run(
    'estrategista', 'Estrategista', 'Calendário editorial mensal, briefing por campanha, define ângulos pros outros agentes.', 'planejar_calendario,briefing_campanha,definir_angulo'
);
db.prepare(`INSERT OR IGNORE INTO agentes (chave, nome, descricao, tipos_aceitos) VALUES (?, ?, ?, ?)`).run(
    'copywriter', 'Copywriter', 'Escreve posts, headlines, captions. Especialista em texto que vende.', 'escrever_post,gerar_headline,reescrever'
);
db.prepare(`INSERT OR IGNORE INTO agentes (chave, nome, descricao, tipos_aceitos) VALUES (?, ?, ?, ?)`).run(
    'community_manager', 'Community Manager', 'Responde DMs e comentários no Insta/WhatsApp. Escalonamento humano quando preciso.', 'responder_dm,responder_comentario,escalonar'
);
db.prepare(`INSERT OR IGNORE INTO agentes (chave, nome, descricao, tipos_aceitos) VALUES (?, ?, ?, ?)`).run(
    'midia_paga', 'Mídia Paga', 'Gerencia Meta Ads e Google Ads. Otimiza segmentação, orçamento, criativos.', 'criar_campanha,otimizar_ads,relatorio_ads'
);

// === Skills sob demanda (padrão Hermes — dormem, acordam por palavra-chave) ===
// Criadas separado do schema.sql pra ser migration idempotente.
db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        slug            TEXT UNIQUE NOT NULL,
        nome            TEXT NOT NULL,
        descricao       TEXT NOT NULL,
        prompt_template TEXT NOT NULL,
        matchers        TEXT NOT NULL DEFAULT '[]',   -- JSON array de palavras-chave
        escopo          TEXT NOT NULL DEFAULT 'both', -- bot | api | both
        ativa           INTEGER NOT NULL DEFAULT 1,
        seed            INTEGER NOT NULL DEFAULT 0,   -- 1 = veio do seed inicial
        criada_em       TEXT NOT NULL DEFAULT (datetime('now')),
        atualizada_em   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skills_slug   ON skills(slug);
    CREATE INDEX IF NOT EXISTS idx_skills_ativa  ON skills(ativa);

    CREATE TABLE IF NOT EXISTS skill_execucoes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id        INTEGER NOT NULL REFERENCES skills(id),
        entrada         TEXT,                          -- texto/input que disparou
        contexto        TEXT,                          -- JSON com info adicional (lead_id, etc)
        output          TEXT,                          -- resposta gerada
        sucesso         INTEGER NOT NULL DEFAULT 1,
        erro            TEXT,
        ms              INTEGER,                       -- tempo de execução
        criada_em       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skill_exec_skill ON skill_execucoes(skill_id);
    CREATE INDEX IF NOT EXISTS idx_skill_exec_data  ON skill_execucoes(criada_em DESC);
`);

// FTS5 virtual table pra busca semântica nas skills (rápido pra Find Skills)
try {
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
            slug, nome, descricao,
            content='skills', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
            INSERT INTO skills_fts(rowid, slug, nome, descricao) VALUES (new.id, new.slug, new.nome, new.descricao);
        END;
        CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
            INSERT INTO skills_fts(skills_fts, rowid, slug, nome, descricao) VALUES('delete', old.id, old.slug, old.nome, old.descricao);
        END;
        CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
            INSERT INTO skills_fts(skills_fts, rowid, slug, nome, descricao) VALUES('delete', old.id, old.slug, old.nome, old.descricao);
            INSERT INTO skills_fts(rowid, slug, nome, descricao) VALUES (new.id, new.slug, new.nome, new.descricao);
        END;
    `);
} catch (e) {
    // Build do better-sqlite3 sem FTS5 — fallback pra LIKE simples na lib
    console.warn('[db] FTS5 indisponível — busca de skills usará LIKE');
}

// Seed das 8 skills do Igor (idempotente — só insere se slug não existir)
const SEED_SKILLS = [
    {
        slug: 'creator',
        nome: 'Skill Creator',
        descricao: 'Cria uma nova skill no sistema a partir de descrição em linguagem natural. O LLM gera prompt_template + matchers automaticamente.',
        matchers: ['cria skill', 'nova skill', 'criar habilidade', 'criar skill', 'skill nova'],
        prompt_template: 'Você é o Skill Creator do Igor Babolin. A partir da descrição abaixo, devolva JSON estrito com:\n{"slug":"kebab-case","nome":"Title Case","descricao":"1 frase","prompt_template":"template com {{input}} placeholder","matchers":["palavra-chave1","palavra-chave2"]}\n\nDESCRIÇÃO: {{input}}',
    },
    {
        slug: 'prompt-design',
        nome: 'Prompt + Design',
        descricao: 'Gera um prompt LLM estruturado e bem desenhado, pronto pra usar em qualquer agente.',
        matchers: ['monta prompt', 'escreve prompt', 'gera prompt', 'cria prompt', 'desenha prompt'],
        prompt_template: 'Você é especialista em prompt engineering. Crie um prompt estruturado pra atender o pedido abaixo. Use seções claras (CONTEXTO, OBJETIVO, FORMATO DE SAÍDA, REGRAS). Tom profissional pt-BR. Devolva APENAS o prompt, sem comentários.\n\nPEDIDO: {{input}}',
    },
    {
        slug: 'pdf',
        nome: 'PDF',
        descricao: 'Produz um documento PDF (proposta, dossiê de imóvel, apresentação ao cliente). HOJE retorna conteúdo em markdown — conversão pra binário será adicionada depois.',
        matchers: ['gera pdf', 'cria pdf', 'pdf de', 'pdf do', 'documento pdf'],
        prompt_template: 'Você é o gerador de PDFs do Igor Babolin (imobiliária Praia do Rosa). Gere o conteúdo do documento solicitado em markdown bem formatado (títulos, listas, tabelas se preciso). Tom profissional, sem clichê de corretor. Foco em informação útil pro cliente.\n\nPEDIDO: {{input}}',
    },
    {
        slug: 'xlsx',
        nome: 'Planilha XLSX',
        descricao: 'Gera tabela/planilha estruturada (relatório financeiro, lista de imóveis, comparativo). HOJE retorna formato CSV/markdown — conversão pra xlsx será adicionada depois.',
        matchers: ['planilha', 'xlsx', 'gera planilha', 'cria tabela', 'tabela comparativa'],
        prompt_template: 'Você é o gerador de planilhas do Igor Babolin. Gere uma tabela em formato CSV (cabeçalho na primeira linha, colunas separadas por vírgula, strings com vírgula devem estar entre aspas). Devolva APENAS o CSV.\n\nPEDIDO: {{input}}',
    },
    {
        slug: 'pptx',
        nome: 'Apresentação PPTX',
        descricao: 'Estrutura uma apresentação de slides (pra apresentar imóvel ao cliente, pitch). HOJE retorna outline markdown — conversão pra pptx será adicionada depois.',
        matchers: ['apresentação', 'apresentacao', 'slides', 'pptx', 'pitch deck'],
        prompt_template: 'Você é o gerador de apresentações do Igor Babolin. Gere uma apresentação em formato markdown com estrutura de slides. Cada slide começa com "## Slide N: Título" e tem 3-5 bullets curtos. Máximo 10 slides. Hook no slide 1, CTA no slide final.\n\nPEDIDO: {{input}}',
    },
    {
        slug: 'docx',
        nome: 'Documento DOCX',
        descricao: 'Gera documento Word formal (ata de reunião, proposta, comunicado). HOJE retorna markdown — conversão pra docx será adicionada depois.',
        matchers: ['docx', 'documento word', 'word', 'gera documento', 'ata de', 'comunicado'],
        prompt_template: 'Você é o gerador de documentos formais do Igor Babolin. Gere o documento solicitado em markdown bem formatado, tom profissional formal (NÃO casual). Use cabeçalho com data, lugar e título centralizados.\n\nPEDIDO: {{input}}',
    },
    {
        slug: 'contratos',
        nome: 'Contratos',
        descricao: 'Gera modelo de contrato (compra/venda, locação, intermediação) preenchido com dados do imóvel/lead quando disponíveis.',
        matchers: ['contrato', 'gera contrato', 'cria contrato', 'modelo de contrato', 'minuta'],
        prompt_template: 'Você é o redator de contratos do Igor Babolin Imóveis (Praia do Rosa - SC). Gere um modelo de contrato em markdown com cláusulas padrão pra imobiliária em SC. Use {{TITULAR}}, {{IMOVEL}}, {{VALOR}}, {{DATA}} como placeholders. Inclua: qualificação das partes, objeto, valor e forma de pagamento, prazo, cláusulas de rescisão, foro. AVISO: este é modelo automático — exige revisão de advogado antes de uso real.\n\nPEDIDO: {{input}}',
    },
    {
        slug: 'find-skills',
        nome: 'Find Skills',
        descricao: 'Busca semântica em todas as skills disponíveis. Útil quando você não sabe o nome exato mas sabe o que quer.',
        matchers: ['que skill faz', 'qual skill', 'find skill', 'tem skill', 'lista skills', 'quais skills'],
        prompt_template: '__FIND_SKILLS__', // tratado especial na lib (não vai pro LLM)
    },
];

const insertSkill = db.prepare(`
    INSERT OR IGNORE INTO skills (slug, nome, descricao, prompt_template, matchers, seed)
    VALUES (?, ?, ?, ?, ?, 1)
`);
for (const s of SEED_SKILLS) {
    insertSkill.run(s.slug, s.nome, s.descricao, s.prompt_template, JSON.stringify(s.matchers));
}

function nowIso() {
    return new Date().toISOString();
}

function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function registrarLog({ agente, nivel = 'info', template = null, mensagem, contexto = null }) {
    const ctx = contexto && typeof contexto === 'object' ? JSON.stringify(contexto) : contexto;
    db.prepare(
        `INSERT INTO logs (agente, nivel, template, mensagem, contexto) VALUES (?, ?, ?, ?, ?)`
    ).run(agente, nivel, template, mensagem, ctx);
}

// Seed só roda se base de leads estiver vazia
function seedDevelopment() {
    const total = db.prepare('SELECT COUNT(*) AS n FROM leads').get();
    if (total.n > 0) return;

    const inserirLead = db.prepare(`
        INSERT INTO leads (id, nome, interesse, telefone, origem, status, score_ia, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const leads = [
        ['lead_seed_1', 'Ricardo Monteiro',  'Apartamento Praia do Rosa',     '+5548999990001', 'facebook',   'novo_lead',      0,  'Veio do anúncio Meta Ads'],
        ['lead_seed_2', 'Juliana Krieger',   'Terreno em Ibiraquera',         '+5548999990002', 'site',       'novo_lead',      0,  'Preencheu formulário'],
        ['lead_seed_3', 'Marcos André',      'Cobertura beira-mar',           '+5548999990003', 'whatsapp',   'em_atendimento', 88, 'Já visitou 2 imóveis'],
        ['lead_seed_4', 'Carla Moretti',     'Casa de praia 4 quartos',       '+5548999990004', 'indicacao',  'qualificado',    94, 'Indicação do Carlos Eduardo'],
        ['lead_seed_5', 'Felipe Tavares',    'Investimento short-stay',       '+5548999990005', 'instagram',  'qualificado',    81, 'Investidor de São Paulo'],
        ['lead_seed_6', 'Beatriz Andrade',   'Loft Rosa Norte',               '+5548999990006', 'site',       'convertido',     97, 'FECHOU em abril/26']
    ];
    const tx = db.transaction(() => {
        for (const l of leads) inserirLead.run(...l);
    });
    tx();

    const inserirEvento = db.prepare(`
        INSERT INTO agenda (id, titulo, descricao, lead_id, inicio, tipo)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const hoje = new Date();
    const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
    const semana = new Date(hoje); semana.setDate(semana.getDate() + 4);
    inserirEvento.run('evt_seed_1', 'Reunião com Marcos André',  'Visita ao apartamento Beira-Mar', 'lead_seed_3', amanha.toISOString(), 'reuniao');
    inserirEvento.run('evt_seed_2', 'Ligação com Carla Moretti', 'Apresentar proposta',             'lead_seed_4', semana.toISOString(), 'ligacao');
    inserirEvento.run('evt_seed_3', 'Post Instagram Praia Rosa', 'Carrossel sobre região',          null,          hoje.toISOString(),   'post');

    console.log('[seed] Inseridos 6 leads de teste e 3 eventos de agenda');
}

seedDevelopment();

module.exports = { db, nowIso, uid, registrarLog };
