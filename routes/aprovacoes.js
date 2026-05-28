const express = require('express');
const { db, nowIso, registrarLog } = require('../db');

const router = express.Router();

// GET /aprovacoes — histórico de decisões do maestro (todas, últimas 100)
// ?status=aprovada|rejeitada|cancelada|todas  (default: todas)
router.get('/', (req, res) => {
    const status = req.query.status || 'todas';
    let rows;
    if (status === 'todas') {
        rows = db.prepare(`
            SELECT a.*, t.status AS tarefa_status, t.concluido_em AS tarefa_concluida_em
            FROM aprovacoes a
            LEFT JOIN fila_tarefas t ON t.id = a.tarefa_id
            ORDER BY a.criado_em DESC LIMIT 100
        `).all();
    } else {
        rows = db.prepare(`
            SELECT a.*, t.status AS tarefa_status, t.concluido_em AS tarefa_concluida_em
            FROM aprovacoes a
            LEFT JOIN fila_tarefas t ON t.id = a.tarefa_id
            WHERE a.status = ?
            ORDER BY a.criado_em DESC LIMIT 100
        `).all(status);
    }
    // Conta só pendentes reais (tarefa ainda não executada)
    const pendentes = rows.filter(r => r.tarefa_status === 'pendente').length;
    res.json({ status, total: rows.length, pendentes, aprovacoes: rows });
});

// POST /aprovacoes/:id/cancelar — cancela tarefa ainda não executada
router.post('/:id/cancelar', (req, res) => {
    const a = db.prepare('SELECT * FROM aprovacoes WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ erro: 'Registro não encontrado' });

    // Verifica se a tarefa ainda está pendente na fila
    if (a.tarefa_id) {
        const tarefa = db.prepare("SELECT status FROM fila_tarefas WHERE id = ?").get(a.tarefa_id);
        if (tarefa && tarefa.status === 'pendente') {
            db.prepare("DELETE FROM fila_tarefas WHERE id = ?").run(a.tarefa_id);
        } else if (tarefa && tarefa.status !== 'pendente') {
            return res.status(409).json({ erro: `Não cancelável — tarefa já está "${tarefa.status}"` });
        }
    }

    db.prepare(`UPDATE aprovacoes SET status = 'cancelada', decidido_em = ? WHERE id = ?`)
        .run(nowIso(), a.id);

    registrarLog({
        agente: 'maestro', nivel: 'alerta',
        mensagem: `Cancelado pelo humano: ${a.descricao}`,
        contexto: { aprovacao_id: a.id, tarefa_id: a.tarefa_id }
    });
    res.json({ ok: true });
});

// Mantém compatibilidade com chamadas antigas de aprovação/rejeição manual
router.post('/:id/aprovar', (req, res) => res.json({ ok: true, info: 'Maestro auto-aprova — endpoint legado' }));
router.post('/:id/rejeitar', (req, res) => {
    db.prepare(`UPDATE aprovacoes SET status='rejeitada', decidido_em=? WHERE id=?`).run(nowIso(), req.params.id);
    res.json({ ok: true });
});
router.post('/aprovar-todas', (_req, res) => res.json({ ok: true, info: 'Maestro auto-aprova tudo automaticamente' }));
router.post('/rejeitar-todas', (_req, res) => {
    const r = db.prepare("UPDATE aprovacoes SET status='rejeitada', decidido_em=? WHERE status='pendente'").run(nowIso());
    res.json({ ok: true, rejeitadas: r.changes });
});

module.exports = router;
