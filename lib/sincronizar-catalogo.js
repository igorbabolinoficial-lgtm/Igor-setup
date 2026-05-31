// lib/sincronizar-catalogo.js — Mantém o catálogo do sistema espelhando o site original,
// sozinho. Roda toda madrugada (cron no maestro). Substitui os botões manuais.
'use strict';

const { db, registrarLog } = require('../db');
const { enriquecerImovel } = require('./enriquecer-imoveis');

function decode(linha) {
    if (!linha) return linha;
    return {
        ...linha,
        fotos:           linha.fotos           ? JSON.parse(linha.fotos)           : [],
        forma_pagamento: linha.forma_pagamento ? JSON.parse(linha.forma_pagamento) : [],
        caracteristicas: linha.caracteristicas ? JSON.parse(linha.caracteristicas) : [],
    };
}

let _rodando = false;
let _ultimo = { quando: null, novos: null, enriquecidos: 0, erro: null };

// Sincroniza: importa imóveis novos do site (com fotos certas) + completa dados dos incompletos.
async function sincronizarCatalogo({ origem = 'cron' } = {}) {
    if (_rodando) return { ok: false, motivo: 'já rodando' };
    _rodando = true;
    const inicio = Date.now();
    try {
        // 1) Importa novos imóveis do site original (skipExistentes = não re-baixa o que já tem)
        const antes = db.prepare('SELECT COUNT(*) AS n FROM imoveis').get().n;
        try {
            const { migrarTudo } = require('../migrator');
            await migrarTudo({ skipExistentes: true });
        } catch (e) {
            registrarLog({ agente: 'sistema', nivel: 'alerta', mensagem: `Sync: migração falhou (${e.message}) — segue pro enriquecimento` });
        }
        const depois = db.prepare('SELECT COUNT(*) AS n FROM imoveis').get().n;
        const novos = depois - antes;

        // 2) Completa dados dos imóveis com campos vazios (só os incompletos — leve)
        const incompletos = db.prepare(`
            SELECT * FROM imoveis
            WHERE bairro IS NULL OR bairro = ''
               OR quartos IS NULL OR quartos = 0
               OR area_m2 IS NULL OR area_m2 = 0
               OR caracteristicas IS NULL OR caracteristicas = '[]' OR caracteristicas = ''
        `).all().map(decode);

        let enriquecidos = 0;
        for (const im of incompletos) {
            try {
                const r = await enriquecerImovel(im);
                if (r.ok && Object.keys(r.mudou || {}).length) enriquecidos++;
            } catch { /* segue */ }
        }

        _ultimo = { quando: new Date().toISOString(), novos, enriquecidos, erro: null };
        registrarLog({
            agente: 'sistema', nivel: 'sucesso',
            mensagem: `Catálogo sincronizado (${origem}): ${novos} novos, ${enriquecidos} completados`,
            contexto: { ms: Date.now() - inicio },
        });
        return { ok: true, novos, enriquecidos };
    } catch (err) {
        _ultimo = { quando: new Date().toISOString(), novos: null, enriquecidos: 0, erro: err.message };
        registrarLog({ agente: 'sistema', nivel: 'erro', mensagem: `Sync catálogo falhou: ${err.message}` });
        return { ok: false, erro: err.message };
    } finally {
        _rodando = false;
    }
}

function statusSync() { return { rodando: _rodando, ultimo: _ultimo }; }

module.exports = { sincronizarCatalogo, statusSync };
