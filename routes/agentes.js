const express = require('express');
const { db } = require('../db');
const maestro = require('../agentes/maestro');

const router = express.Router();

router.get('/', (_req, res) => {
    const linhas = db.prepare(`
        SELECT a.*,
            (SELECT COUNT(*) FROM fila_tarefas f WHERE f.agente_destino = a.chave AND f.status = 'pendente')   AS pendentes,
            (SELECT COUNT(*) FROM fila_tarefas f WHERE f.agente_destino = a.chave AND f.status = 'executando') AS executando
        FROM agentes a
        ORDER BY (a.chave = 'maestro') DESC, a.nome ASC
    `).all();
    res.json({ total: linhas.length, agentes: linhas });
});

// Endpoint pro Escritório Voxel 3D — formato esperado pelo OfficeArena.jsx
// Mapeia heartbeat + fila + logs em: status (rodando/recente/aguardando/pronto/degradado),
// segundos_desde_ultimo, runs_24h, erros_24h, ultimo_erro, pendentes, executando.
router.get('/status', (_req, res) => {
    const linhas = db.prepare(`
        SELECT
            a.chave,
            a.nome,
            a.ultimo_heartbeat,
            a.tarefas_executadas,
            a.tarefas_falhadas,
            (SELECT COUNT(*) FROM fila_tarefas f WHERE f.agente_destino = a.chave AND f.status = 'pendente')   AS pendentes,
            (SELECT COUNT(*) FROM fila_tarefas f WHERE f.agente_destino = a.chave AND f.status = 'executando') AS executando,
            (SELECT COUNT(*) FROM logs l
                WHERE l.agente = a.chave
                  AND l.criado_em >= datetime('now', '-24 hours')) AS runs_24h,
            (SELECT COUNT(*) FROM logs l
                WHERE l.agente = a.chave
                  AND l.nivel IN ('erro', 'alerta')
                  AND l.criado_em >= datetime('now', '-24 hours')) AS erros_24h,
            (SELECT l.mensagem FROM logs l
                WHERE l.agente = a.chave AND l.nivel = 'erro'
                ORDER BY l.criado_em DESC LIMIT 1) AS ultimo_erro
        FROM agentes a
        WHERE a.ativo = 1
    `).all();

    const agora = Date.now();
    const agentes = linhas.map(row => {
        const ts = row.ultimo_heartbeat ? Date.parse(row.ultimo_heartbeat) : null;
        const segDesde = ts ? Math.floor((agora - ts) / 1000) : null;

        let status;
        if (row.executando > 0) status = 'rodando';
        else if (segDesde !== null && segDesde < 60) status = 'rodando';
        else if (segDesde !== null && segDesde < 300) status = 'recente';
        else if (row.pendentes > 0) status = 'aguardando';
        else if (segDesde !== null && segDesde < 86400) status = 'pronto';
        else if (segDesde === null) status = 'aguardando';
        else status = 'degradado';

        return {
            nome: row.chave,                            // chave é o id usado pelo 3D
            label: row.nome,
            status,
            segundos_desde_ultimo: segDesde,
            ultimo_heartbeat: row.ultimo_heartbeat,
            pendentes: row.pendentes,
            executando: row.executando,
            runs_24h: row.runs_24h,
            erros_24h: row.erros_24h,
            ultimo_erro: row.ultimo_erro || null,
            cron_ativo: true,                           // todos os agentes do Igor rodam via proativo.js
        };
    });

    res.json({ total: agentes.length, agentes });
});

router.post('/ciclo', async (_req, res, next) => {
    try {
        await maestro.ciclo();
        res.json({ ok: true });
    } catch (err) { next(err); }
});

router.post('/pensar-ia', async (_req, res, next) => {
    try {
        const r = await maestro.pensarComIA();
        if (r === null) return res.json({ ok: false, motivo: 'Gemini API key não configurada ou falhou' });
        res.json({ ok: true, decisoes: r });
    } catch (err) { next(err); }
});

router.post('/tarefas', (req, res) => {
    const { agente_destino, tipo, payload, prioridade } = req.body || {};
    if (!agente_destino || !tipo) return res.status(400).json({ erro: 'agente_destino e tipo são obrigatórios' });
    const id = maestro.enfileirar({ agente_destino, tipo, payload, prioridade });
    res.status(201).json({ id, status: 'pendente' });
});

router.get('/tarefas', (req, res) => {
    const { status, agente_destino, limite = 50 } = req.query;
    const where = [];
    const params = [];
    if (status)         { where.push('status = ?'); params.push(status); }
    if (agente_destino) { where.push('agente_destino = ?'); params.push(agente_destino); }
    const sql = `
        SELECT * FROM fila_tarefas
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY criado_em DESC
        LIMIT ?
    `;
    const tarefas = db.prepare(sql).all(...params, Math.min(500, Number(limite)));
    res.json({ total: tarefas.length, tarefas });
});

module.exports = router;
