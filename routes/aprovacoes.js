const express = require('express');
const { db, nowIso, registrarLog } = require('../db');
const maestro = require('../agentes/maestro');

const router = express.Router();

router.get('/', (req, res) => {
    const status = req.query.status || 'pendente';
    const linhas = db.prepare(`
        SELECT * FROM aprovacoes WHERE status = ? ORDER BY criado_em DESC LIMIT 100
    `).all(status);
    res.json({ status, total: linhas.length, aprovacoes: linhas });
});

router.post('/', (req, res) => {
    const { agente_destino, tipo, payload, descricao } = req.body || {};
    if (!agente_destino || !tipo || !descricao) {
        return res.status(400).json({ erro: 'agente_destino, tipo e descricao obrigatórios' });
    }
    const r = db.prepare(`
        INSERT INTO aprovacoes (agente_destino, tipo, payload, descricao)
        VALUES (?, ?, ?, ?)
    `).run(agente_destino, tipo, payload ? JSON.stringify(payload) : null, descricao);
    registrarLog({
        agente: 'maestro', nivel: 'alerta',
        mensagem: `Aguardando aprovação humana: ${descricao}`,
        contexto: { aprovacao_id: r.lastInsertRowid }
    });
    res.status(201).json({ id: r.lastInsertRowid, status: 'pendente' });
});

router.post('/:id/aprovar', (req, res) => {
    const a = db.prepare('SELECT * FROM aprovacoes WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ erro: 'Aprovação não encontrada' });
    if (a.status !== 'pendente') return res.status(400).json({ erro: `Já está ${a.status}` });

    const tarefaId = maestro.enfileirar({
        agente_destino: a.agente_destino,
        tipo: a.tipo,
        payload: a.payload ? JSON.parse(a.payload) : null,
        prioridade: 2
    });
    db.prepare(`UPDATE aprovacoes SET status='aprovada', decidido_em=?, tarefa_id=? WHERE id=?`)
        .run(nowIso(), tarefaId, a.id);
    registrarLog({
        agente: 'maestro', nivel: 'sucesso',
        mensagem: `Humano aprovou: ${a.descricao}`,
        contexto: { aprovacao_id: a.id, tarefa_id: tarefaId }
    });
    res.json({ ok: true, tarefa_id: tarefaId });
});

router.post('/aprovar-todas', (_req, res) => {
    const pendentes = db.prepare("SELECT * FROM aprovacoes WHERE status='pendente'").all();
    let aprovadas = 0;
    const tx = db.transaction(() => {
        for (const a of pendentes) {
            const tarefaId = maestro.enfileirar({
                agente_destino: a.agente_destino,
                tipo: a.tipo,
                payload: a.payload ? JSON.parse(a.payload) : null,
                prioridade: 2
            });
            db.prepare(`UPDATE aprovacoes SET status='aprovada', decidido_em=?, tarefa_id=? WHERE id=?`)
                .run(nowIso(), tarefaId, a.id);
            aprovadas++;
        }
    });
    tx();
    if (aprovadas) registrarLog({
        agente: 'maestro', nivel: 'sucesso',
        mensagem: `Humano aprovou ${aprovadas} tarefas em massa`,
        contexto: { aprovadas }
    });
    res.json({ ok: true, aprovadas });
});

router.post('/rejeitar-todas', (_req, res) => {
    const r = db.prepare("UPDATE aprovacoes SET status='rejeitada', decidido_em=? WHERE status='pendente'").run(nowIso());
    if (r.changes) registrarLog({
        agente: 'maestro', nivel: 'alerta',
        mensagem: `Humano rejeitou ${r.changes} tarefas em massa`
    });
    res.json({ ok: true, rejeitadas: r.changes });
});

router.post('/:id/rejeitar', (req, res) => {
    const a = db.prepare('SELECT * FROM aprovacoes WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ erro: 'Aprovação não encontrada' });
    if (a.status !== 'pendente') return res.status(400).json({ erro: `Já está ${a.status}` });
    db.prepare(`UPDATE aprovacoes SET status='rejeitada', decidido_em=? WHERE id=?`)
        .run(nowIso(), a.id);
    registrarLog({
        agente: 'maestro', nivel: 'alerta',
        mensagem: `Humano rejeitou: ${a.descricao}`,
        contexto: { aprovacao_id: a.id }
    });
    res.json({ ok: true });
});

module.exports = router;
