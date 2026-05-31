// routes/treinamento.js — Base de conhecimento do Igor.
// Upload de áudios (transcreve via Groq Whisper), textos e contratos.
// Conteúdo ativo é injetado no system prompt do Babolin (wa-agent).

const express = require('express');
const multer  = require('multer');
const { db, uid, nowIso } = require('../db');

const router = express.Router();

// Multer: memória, limite 25 MB, aceita áudio + texto
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const okMime = /^(audio|text)\//i.test(file.mimetype);
        const okExt  = /\.(mp3|ogg|wav|m4a|mp4|webm|aac|txt)$/i.test(file.originalname);
        cb(null, okMime || okExt);
    },
});

// Categorias fixas — ordem exibida no painel
const CATEGORIAS = [
    { id: 'dna_igor',   nome: 'DNA Igor',            descricao: 'Estilo, vocabulário, jeito de falar' },
    { id: 'argumentos', nome: 'Argumentos de Venda', descricao: 'Argumentos por tipo de imóvel, objeção, região' },
    { id: 'contratos',  nome: 'Contratos',           descricao: 'Modelos de contrato, cláusulas padrão' },
    { id: 'regiao',     nome: 'Região',              descricao: 'Praia do Rosa, Garopaba, Imbituba — conhecimento local' },
    { id: 'pipeline',   nome: 'Pipeline',            descricao: 'Qualificação, processo de atendimento' },
    { id: 'regras',     nome: 'Correções aprendidas', descricao: 'Regras aprovadas das análises de conversa (auto-melhoria do bot)' },
    { id: 'outros',     nome: 'Outros',              descricao: 'Conteúdo geral' },
];

const CAT_NOMES = Object.fromEntries(CATEGORIAS.map(c => [c.id, c.nome]));

// ── Transcrição via Groq Whisper (usando fetch nativo Node 20) ────────────────
async function transcreverAudio(buffer, mimetype, nomeArquivo) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY não configurado');

    const ext  = (nomeArquivo || 'audio').split('.').pop().toLowerCase();
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimetype || 'audio/mpeg' }), `audio.${ext}`);
    form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || `Groq ${r.status}`);
    return (data.text || '').trim();
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

// GET /api/treinamento/categorias
router.get('/categorias', (_req, res) => res.json({ categorias: CATEGORIAS }));

// GET /api/treinamento — tudo agrupado por categoria
router.get('/', (_req, res) => {
    const itens = db.prepare(`
        SELECT id, categoria, nome, tipo, ativo,
               SUBSTR(conteudo, 1, 200) AS excerpt,
               LENGTH(conteudo) AS chars,
               arquivo, criado_em, atualizado_em
        FROM treinamento
        ORDER BY categoria, criado_em DESC
    `).all();

    const agrupado = {};
    for (const cat of CATEGORIAS) agrupado[cat.id] = [];
    for (const item of itens) {
        const key = CATEGORIAS.find(c => c.id === item.categoria) ? item.categoria : 'outros';
        agrupado[key].push(item);
    }
    res.json({ categorias: CATEGORIAS, itens: agrupado, total: itens.length });
});

// GET /api/treinamento/:id — item completo (com conteúdo integral)
router.get('/:id', (req, res) => {
    const item = db.prepare('SELECT * FROM treinamento WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ erro: 'Item não encontrado' });
    res.json(item);
});

// GET /api/treinamento-contexto — bloco formatado pra injetar no system prompt do bot
// Rota separada pra evitar conflito com /:id
router.get('-contexto', (_req, res) => {
    const itens = db.prepare(`
        SELECT categoria, nome, conteudo
        FROM treinamento
        WHERE ativo = 1 AND conteudo IS NOT NULL AND TRIM(conteudo) != ''
        ORDER BY categoria, criado_em ASC
    `).all();

    if (!itens.length) return res.json({ contexto: '', total: 0 });

    const grupos = {};
    for (const it of itens) {
        const cat = it.categoria in CAT_NOMES ? it.categoria : 'outros';
        if (!grupos[cat]) grupos[cat] = [];
        grupos[cat].push(`• ${it.nome}:\n${it.conteudo}`);
    }

    const linhas = ['=== MATERIAL DE TREINAMENTO DO IGOR ==='];
    for (const catId of CATEGORIAS.map(c => c.id)) {
        if (!grupos[catId]?.length) continue;
        linhas.push(`\n[${CAT_NOMES[catId] || catId}]`);
        linhas.push(grupos[catId].join('\n\n'));
    }
    linhas.push('\n=== FIM DO MATERIAL ===');

    res.json({ contexto: linhas.join('\n'), total: itens.length });
});

// POST /api/treinamento — cria item de texto manual
router.post('/', (req, res) => {
    const { categoria = 'outros', nome, conteudo } = req.body || {};
    if (!nome || !nome.trim()) return res.status(400).json({ erro: 'nome obrigatório' });
    if (!conteudo || !conteudo.trim()) return res.status(400).json({ erro: 'conteudo obrigatório' });

    const id = uid('treino');
    db.prepare(`
        INSERT INTO treinamento (id, categoria, nome, tipo, conteudo)
        VALUES (?, ?, ?, 'texto', ?)
    `).run(id, categoria, nome.trim(), conteudo.trim());

    res.status(201).json(db.prepare('SELECT * FROM treinamento WHERE id = ?').get(id));
});

// POST /api/treinamento/upload — áudio → transcreve | txt → lê direto
router.post('/upload', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro: 'arquivo obrigatório (campo: arquivo)' });

        const { categoria = 'outros', nome: nomeParam } = req.body || {};
        const nomeArquivo = req.file.originalname || 'arquivo';
        const isAudio = /^audio\//i.test(req.file.mimetype)
            || /\.(mp3|ogg|wav|m4a|aac|webm)$/i.test(nomeArquivo);

        let conteudo = '';
        let tipo     = 'texto';

        if (isAudio) {
            tipo     = 'audio';
            conteudo = await transcreverAudio(req.file.buffer, req.file.mimetype, nomeArquivo);
        } else {
            // .txt ou outro texto
            conteudo = req.file.buffer.toString('utf-8').trim();
        }

        const nomeItem = (nomeParam || '').trim() || nomeArquivo.replace(/\.[^.]+$/, '');
        const id       = uid('treino');
        db.prepare(`
            INSERT INTO treinamento (id, categoria, nome, tipo, conteudo, arquivo)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, categoria, nomeItem, tipo, conteudo, nomeArquivo);

        res.status(201).json({
            ...db.prepare('SELECT * FROM treinamento WHERE id = ?').get(id),
            transcrito: isAudio,
        });
    } catch (e) {
        console.error('[treinamento] upload erro:', e.message);
        res.status(500).json({ erro: e.message });
    }
});

// PATCH /api/treinamento/:id — edita nome, conteúdo, categoria, ativo
router.patch('/:id', (req, res) => {
    const item = db.prepare('SELECT * FROM treinamento WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ erro: 'Item não encontrado' });

    const permitidos = ['nome', 'conteudo', 'categoria', 'ativo'];
    const sets   = [];
    const params = [];
    for (const campo of permitidos) {
        if (campo in (req.body || {})) {
            sets.push(`${campo} = ?`);
            params.push(req.body[campo]);
        }
    }
    if (!sets.length) return res.json(item);

    sets.push('atualizado_em = ?');
    params.push(nowIso(), req.params.id);
    db.prepare(`UPDATE treinamento SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT * FROM treinamento WHERE id = ?').get(req.params.id));
});

// DELETE /api/treinamento/:id
router.delete('/:id', (req, res) => {
    const item = db.prepare('SELECT * FROM treinamento WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ erro: 'Item não encontrado' });
    db.prepare('DELETE FROM treinamento WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
