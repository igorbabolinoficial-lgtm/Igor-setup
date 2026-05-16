const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'igor.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

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
