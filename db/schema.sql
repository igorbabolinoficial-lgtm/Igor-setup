-- Igor Neural System — schema SQLite
-- Convenções: snake_case em pt-BR. Status enums em pt-BR.

CREATE TABLE IF NOT EXISTS leads (
    id              TEXT PRIMARY KEY,
    nome            TEXT NOT NULL,
    interesse       TEXT,
    telefone        TEXT,
    email           TEXT,
    origem          TEXT,                          -- whatsapp, instagram, site, indicacao, manual
    status          TEXT NOT NULL DEFAULT 'novo_lead', -- novo_lead, qualificado, em_atendimento, convertido, perdido
    score_ia        INTEGER DEFAULT 0,             -- 0..100
    notas           TEXT,
    ultimo_contato  TEXT,
    criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_score  ON leads(score_ia DESC);
CREATE INDEX IF NOT EXISTS idx_leads_nome   ON leads(nome);

CREATE TABLE IF NOT EXISTS agenda (
    id              TEXT PRIMARY KEY,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    lead_id         TEXT REFERENCES leads(id) ON DELETE SET NULL,
    inicio          TEXT NOT NULL,                 -- ISO 8601
    fim             TEXT,
    tipo            TEXT DEFAULT 'reuniao',        -- reuniao, ligacao, post, tarefa
    status          TEXT DEFAULT 'agendado',       -- agendado, concluido, cancelado
    criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agenda_inicio ON agenda(inicio);
CREATE INDEX IF NOT EXISTS idx_agenda_lead   ON agenda(lead_id);

CREATE TABLE IF NOT EXISTS logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agente          TEXT NOT NULL,                 -- sdr, financeiro, social, sistema
    nivel           TEXT NOT NULL DEFAULT 'info',  -- info, sucesso, alerta, erro
    template        TEXT,                          -- chave do template de automacao (1..8)
    mensagem        TEXT NOT NULL,
    contexto        TEXT,                          -- JSON serializado (ids, payloads, etc.)
    criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_criado ON logs(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_logs_agente ON logs(agente);
CREATE INDEX IF NOT EXISTS idx_logs_nivel  ON logs(nivel);

-- Configurações chave/valor (API keys, personas, paths)
CREATE TABLE IF NOT EXISTS config (
    chave           TEXT PRIMARY KEY,
    valor           TEXT,
    sensivel        INTEGER NOT NULL DEFAULT 0,    -- 1 = mascarar em GET
    atualizado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Status das integrações (8 APIs)
CREATE TABLE IF NOT EXISTS integracoes (
    chave           TEXT PRIMARY KEY,              -- whatsapp, n8n, supabase, gemini, anthropic, instagram, email, calendar
    rotulo          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'desconhecido', -- online, offline, alerta, desconhecido
    ultima_checagem TEXT,
    detalhe         TEXT
);

INSERT OR IGNORE INTO integracoes (chave, rotulo) VALUES
    ('whatsapp',  'WhatsApp (Z-API)'),
    ('n8n',       'n8n Cloud'),
    ('supabase',  'Supabase DB'),
    ('gemini',    'Gemini'),
    ('anthropic', 'Anthropic (Claude)'),
    ('instagram', 'Instagram'),
    ('email',     'E-mail SMTP'),
    ('calendar',  'Google Calendar');

-- Fila de tarefas processada pelo Maestro
CREATE TABLE IF NOT EXISTS fila_tarefas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agente_destino  TEXT NOT NULL,                 -- maestro, sdr, financeiro, designer, social, pesquisa, atendimento
    tipo            TEXT NOT NULL,                 -- qualificar_lead, gerar_post, classificar_tx, etc.
    payload         TEXT,                          -- JSON
    prioridade      INTEGER NOT NULL DEFAULT 5,    -- 1 (alta) .. 10 (baixa)
    status          TEXT NOT NULL DEFAULT 'pendente', -- pendente, executando, concluida, falhou
    resultado       TEXT,
    erro            TEXT,
    criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
    iniciado_em     TEXT,
    concluido_em    TEXT
);
CREATE INDEX IF NOT EXISTS idx_fila_status     ON fila_tarefas(status, prioridade);
CREATE INDEX IF NOT EXISTS idx_fila_agente     ON fila_tarefas(agente_destino);

-- Fila de aprovação humana (tarefas sensíveis exigem 1 clique do usuário)
CREATE TABLE IF NOT EXISTS aprovacoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agente_destino  TEXT NOT NULL,
    tipo            TEXT NOT NULL,
    payload         TEXT,
    descricao       TEXT,                      -- texto curto p/ usuário ler antes de aprovar
    status          TEXT NOT NULL DEFAULT 'pendente', -- pendente, aprovada, rejeitada
    criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
    decidido_em     TEXT,
    tarefa_id       INTEGER                    -- preenchido após aprovar e enfileirar
);
CREATE INDEX IF NOT EXISTS idx_aprov_status ON aprovacoes(status);

-- Status vivo dos agentes
CREATE TABLE IF NOT EXISTS agentes (
    chave             TEXT PRIMARY KEY,
    nome              TEXT NOT NULL,
    descricao         TEXT,
    tipos_aceitos     TEXT,                        -- CSV de tipos de tarefa
    ativo             INTEGER NOT NULL DEFAULT 1,
    ultimo_heartbeat  TEXT,
    tarefas_executadas INTEGER NOT NULL DEFAULT 0,
    tarefas_falhadas   INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO agentes (chave, nome, descricao, tipos_aceitos) VALUES
    ('maestro',     'Igor (Maestro)', 'IA principal. Escaneia o estado, decide e dispara tarefas pros especialistas.', 'orquestrar,heartbeat'),
    ('sdr',         'SDR',         'Qualifica leads, faz follow-up e move o Kanban.', 'qualificar_lead,follow_up,boas_vindas'),
    ('financeiro',  'Financeiro',  'Categoriza transações e monta relatórios.',         'classificar_tx,relatorio_dre'),
    ('designer',    'Designer',    'Gera artes/imagens para posts e materiais.',         'gerar_arte,editar_imagem'),
    ('social',      'Social',      'Cria e agenda posts; responde DMs.',                 'gerar_post,agendar_post,responder_dm'),
    ('pesquisa',    'Pesquisa',    'Vasculha mercado, preços, concorrência.',            'pesquisar_mercado,monitorar_concorrencia'),
    ('atendimento', 'Atendimento', 'Pós-venda: documentação, vistoria, dúvidas.',        'atender_cliente,documentacao_pos');

-- Catálogo de imóveis (importado via migrator.js)
CREATE TABLE IF NOT EXISTS imoveis (
    id              TEXT PRIMARY KEY,           -- data-id do site
    slug            TEXT UNIQUE NOT NULL,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    preco           REAL,
    moeda           TEXT DEFAULT 'BRL',
    quartos         INTEGER,
    banheiros       INTEGER,
    area_m2         REAL,
    tipo            TEXT,
    bairro          TEXT,
    fotos           TEXT,                        -- JSON array de caminhos locais
    url_origem      TEXT,
    importado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_imoveis_preco ON imoveis(preco);
CREATE INDEX IF NOT EXISTS idx_imoveis_tipo  ON imoveis(tipo);

-- Templates de automação (8 cards do Console de Logs)
CREATE TABLE IF NOT EXISTS templates_automacao (
    chave           TEXT PRIMARY KEY,
    titulo          TEXT NOT NULL,
    agente          TEXT NOT NULL,                 -- sdr, financeiro, social
    descricao       TEXT,
    ativo           INTEGER NOT NULL DEFAULT 1,
    ordem           INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO templates_automacao (chave, titulo, agente, descricao, ordem) VALUES
    ('boas_vindas',        'Boas-vindas WhatsApp',       'sdr',        'Envia mensagem inicial ao novo lead', 1),
    ('qualificacao',       'Qualificação automática',    'sdr',        'Pontua lead via Gemini e move no Kanban', 2),
    ('follow_up',          'Follow-up 24h',              'sdr',        'Reengaja lead sem resposta em 24h', 3),
    ('agendamento',        'Agendamento de reunião',     'sdr',        'Cria evento na agenda quando lead vira qualificado', 4),
    ('post_diario',        'Post diário',                'social',     'Gera e agenda post a partir do Cérebro', 5),
    ('resposta_dm',        'Resposta DM Instagram',      'social',     'Responde mensagens diretas no Instagram', 6),
    ('classificacao_tx',   'Classificação de transação', 'financeiro', 'Categoriza transações bancárias', 7),
    ('relatorio_semanal',  'Relatório semanal',          'financeiro', 'Compila DRE e envia toda segunda', 8);
