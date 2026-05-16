const { db, nowIso, registrarLog } = require('../db');

function heartbeat(chave) {
    db.prepare('UPDATE agentes SET ultimo_heartbeat = ? WHERE chave = ?').run(nowIso(), chave);
}

function incrementar(chave, sucesso) {
    const campo = sucesso ? 'tarefas_executadas' : 'tarefas_falhadas';
    db.prepare(`UPDATE agentes SET ${campo} = ${campo} + 1 WHERE chave = ?`).run(chave);
}

async function executarTarefa(agente, tarefa) {
    db.prepare("UPDATE fila_tarefas SET status = 'executando', iniciado_em = ? WHERE id = ?")
        .run(nowIso(), tarefa.id);

    registrarLog({
        agente: agente.chave, nivel: 'info',
        mensagem: `Iniciando ${tarefa.tipo}`,
        contexto: { tarefa_id: tarefa.id, payload: tarefa.payload }
    });

    try {
        const payload = tarefa.payload ? JSON.parse(tarefa.payload) : {};
        const resultado = await agente.executar({ ...tarefa, payload });
        const resumo = typeof resultado === 'string' ? resultado : JSON.stringify(resultado);

        db.prepare(`
            UPDATE fila_tarefas SET status = 'concluida', resultado = ?, concluido_em = ? WHERE id = ?
        `).run(resumo, nowIso(), tarefa.id);

        incrementar(agente.chave, true);
        registrarLog({
            agente: agente.chave, nivel: 'sucesso',
            mensagem: `${tarefa.tipo} concluída`,
            contexto: { tarefa_id: tarefa.id, resultado: resumo }
        });
    } catch (err) {
        db.prepare(`
            UPDATE fila_tarefas SET status = 'falhou', erro = ?, concluido_em = ? WHERE id = ?
        `).run(err.message, nowIso(), tarefa.id);
        incrementar(agente.chave, false);
        registrarLog({
            agente: agente.chave, nivel: 'erro',
            mensagem: `${tarefa.tipo} falhou: ${err.message}`,
            contexto: { tarefa_id: tarefa.id, stack: err.stack }
        });
    }
    heartbeat(agente.chave);
}

module.exports = { heartbeat, executarTarefa };
