const express = require('express');
const { db, uid, nowIso, registrarLog } = require('../db');
const googleLib = require('../lib/google');

const router = express.Router();

const STATUS_VALIDOS = ['novo_lead', 'qualificado', 'em_atendimento', 'convertido', 'perdido'];

function normalizar(lead) {
    if (!lead) return null;
    let tags = [];
    if (lead.tags_ia) {
        try { tags = JSON.parse(lead.tags_ia); } catch (_) { tags = []; }
    }
    return {
        ...lead,
        score_ia: Number(lead.score_ia) || 0,
        tags_ia: tags,
        segmento: lead.segmento || null,
        eh_treino: lead.origem === 'treino',
        arquivado: !!lead.arquivado
    };
}

router.get('/', (req, res) => {
    const { status, q, score_min, ordenar = 'score', segmento, tag, incluir_treino, incluir_arquivados } = req.query;
    const where = [];
    const params = [];

    if (status && STATUS_VALIDOS.includes(status)) { where.push('status = ?'); params.push(status); }
    if (q) {
        where.push('(nome LIKE ? OR interesse LIKE ? OR telefone LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like);
    }
    if (score_min) { where.push('score_ia >= ?'); params.push(Number(score_min)); }
    if (segmento)  { where.push('segmento = ?');  params.push(segmento); }
    if (tag)       { where.push('tags_ia LIKE ?'); params.push(`%"${tag}"%`); }

    // Por padrão esconde leads de treino e arquivados
    if (incluir_treino !== 'true')      where.push("origem != 'treino'");
    if (incluir_arquivados !== 'true')  where.push('(arquivado IS NULL OR arquivado = 0)');

    const orderBy = ordenar === 'recente' ? 'criado_em DESC' : 'score_ia DESC, criado_em DESC';
    const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
    const linhas = db.prepare(sql).all(...params).map(normalizar);

    res.json({ total: linhas.length, leads: linhas });
});

router.get('/kanban', (req, res) => {
    const incluirTreino = req.query.incluir_treino === 'true';
    const colunas = {};
    for (const s of STATUS_VALIDOS) colunas[s] = [];
    const where = ['(arquivado IS NULL OR arquivado = 0)'];
    if (!incluirTreino) where.push("origem != 'treino'");
    const linhas = db.prepare(`SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY score_ia DESC, criado_em DESC`).all();
    for (const l of linhas) {
        const col = STATUS_VALIDOS.includes(l.status) ? l.status : 'novo_lead';
        colunas[col].push(normalizar(l));
    }
    res.json(colunas);
});

// POST /by-phone/status — atualiza status do lead pelo telefone (chamado pelo wa-agent).
// Nunca regride: se o lead já está em status >= ao solicitado, ignora silenciosamente.
router.post('/by-phone/status', (req, res) => {
    const { telefone, status } = req.body || {};
    if (!telefone || !STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ erro: 'telefone e status são obrigatórios', validos: STATUS_VALIDOS });
    }

    // Resolve variantes do telefone (com/sem 55, com/sem 9 inicial)
    const digits = String(telefone).replace(/\D/g, '');
    const variantes = [digits];
    if (digits.startsWith('55')) variantes.push(digits.slice(2));
    else variantes.push('55' + digits);

    let lead = null;
    for (const v of variantes) {
        lead = db.prepare('SELECT * FROM leads WHERE telefone = ? OR telefone LIKE ?').get(v, `%${v}%`);
        if (lead) break;
    }
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado pelo telefone', telefone });

    // Não regride status (novo_lead < em_atendimento < qualificado < convertido)
    const ORDEM = { novo_lead: 0, em_atendimento: 1, qualificado: 2, convertido: 3, perdido: -1 };
    if ((ORDEM[status] ?? 0) <= (ORDEM[lead.status] ?? 0)) {
        return res.json({ ok: true, noChange: true, lead: normalizar(lead) });
    }

    const anterior = lead.status;
    db.prepare('UPDATE leads SET status = ?, atualizado_em = ? WHERE id = ?').run(status, nowIso(), lead.id);
    registrarLog({
        agente: 'whatsapp', nivel: 'sucesso', template: 'qualificacao',
        mensagem: `Lead "${lead.nome}" movido automaticamente: ${anterior} → ${status}`,
        contexto: { lead_id: lead.id, de: anterior, para: status, telefone },
    });
    res.json({ ok: true, noChange: false, lead: normalizar(db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)) });
});

router.get('/:id', (req, res) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });
    res.json(normalizar(lead));
});

router.get('/:id/timeline', (req, res) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });

    const idLike = `%${lead.id}%`;
    const eventos = [];

    // Logs onde o lead aparece (no contexto JSON ou na mensagem)
    for (const l of db.prepare(`
        SELECT id, agente, nivel, mensagem, contexto, criado_em FROM logs
        WHERE contexto LIKE ? OR mensagem LIKE ?
        ORDER BY criado_em DESC LIMIT 200
    `).all(idLike, `%${lead.nome}%`)) {
        eventos.push({ tipo: 'log', em: l.criado_em, agente: l.agente, nivel: l.nivel, descricao: l.mensagem, ref: l.id });
    }

    // Tarefas relacionadas
    for (const t of db.prepare(`
        SELECT id, agente_destino, tipo, status, criado_em, concluido_em, resultado FROM fila_tarefas
        WHERE payload LIKE ? ORDER BY criado_em DESC LIMIT 100
    `).all(idLike)) {
        eventos.push({
            tipo: 'tarefa', em: t.criado_em, agente: t.agente_destino,
            descricao: `Tarefa ${t.tipo} (${t.status})`, ref: `tarefa_${t.id}`,
            concluido_em: t.concluido_em
        });
    }

    // Aprovações pendentes/decididas relacionadas
    for (const a of db.prepare(`
        SELECT id, agente_destino, tipo, descricao, status, criado_em, decidido_em FROM aprovacoes
        WHERE payload LIKE ? ORDER BY criado_em DESC LIMIT 100
    `).all(idLike)) {
        eventos.push({
            tipo: 'aprovacao', em: a.criado_em, agente: a.agente_destino,
            descricao: `Aprovação ${a.tipo}: ${a.descricao} (${a.status})`,
            ref: `aprovacao_${a.id}`
        });
    }

    // Eventos de agenda atrelados
    for (const ev of db.prepare(`
        SELECT id, titulo, descricao, inicio, tipo, status FROM agenda
        WHERE lead_id = ? ORDER BY inicio DESC LIMIT 100
    `).all(lead.id)) {
        eventos.push({
            tipo: 'agenda', em: ev.inicio, agente: 'agenda',
            descricao: `${ev.tipo}: ${ev.titulo} (${ev.status})`, ref: ev.id
        });
    }

    eventos.sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0));

    res.json({
        lead: normalizar(lead),
        total_eventos: eventos.length,
        timeline: eventos
    });
});

router.post('/:id/arquivar', (req, res) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });
    db.prepare('UPDATE leads SET arquivado = 1, atualizado_em = ? WHERE id = ?').run(nowIso(), lead.id);
    registrarLog({ agente: 'sistema', nivel: 'info', mensagem: `Lead arquivado: ${lead.nome}`, contexto: { lead_id: lead.id } });
    res.json({ ok: true });
});

router.post('/', (req, res) => {
    const { nome, interesse, telefone, email, origem = 'manual', score_ia = 0, notas } = req.body || {};
    if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });

    const id = uid('lead');
    db.prepare(`
        INSERT INTO leads (id, nome, interesse, telefone, email, origem, score_ia, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, nome, interesse, telefone, email, origem, Number(score_ia) || 0, notas);

    registrarLog({
        agente: 'sdr', nivel: 'info', template: 'boas_vindas',
        mensagem: `Novo lead criado: ${nome}`, contexto: { lead_id: id, origem }
    });

    // Best-effort: append na Sheet do Igor (se OAuth configurado)
    if (googleLib.isReady()) {
        googleLib.sheets.appendLead({
            nome, telefone: telefone || '', origem, interesse: interesse || '', mensagem: notas || '',
        }).catch((err) => {
            console.error('[leads] Falha append Sheet:', err.message);
        });
    }

    res.status(201).json(normalizar(db.prepare('SELECT * FROM leads WHERE id = ?').get(id)));
});

router.patch('/:id', (req, res) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });

    const campos = ['nome', 'interesse', 'telefone', 'email', 'origem', 'score_ia', 'notas', 'ultimo_contato'];
    const sets = [];
    const params = [];
    for (const c of campos) {
        if (c in (req.body || {})) {
            sets.push(`${c} = ?`);
            params.push(req.body[c]);
        }
    }
    if (!sets.length) return res.json(normalizar(lead));

    sets.push('atualizado_em = ?');
    params.push(nowIso());
    params.push(req.params.id);

    db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json(normalizar(db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)));
});

router.patch('/:id/status', (req, res) => {
    const { status } = req.body || {};
    if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ erro: 'Status inválido', validos: STATUS_VALIDOS });
    }
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });

    db.prepare('UPDATE leads SET status = ?, atualizado_em = ? WHERE id = ?')
        .run(status, nowIso(), req.params.id);

    registrarLog({
        agente: 'sdr', nivel: 'sucesso', template: 'qualificacao',
        mensagem: `Lead "${lead.nome}" movido: ${lead.status} → ${status}`,
        contexto: { lead_id: lead.id, de: lead.status, para: status }
    });

    res.json(normalizar(db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado' });
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    registrarLog({
        agente: 'sistema', nivel: 'alerta',
        mensagem: `Lead removido: ${lead.nome}`, contexto: { lead_id: lead.id }
    });
    res.json({ ok: true });
});

module.exports = router;
