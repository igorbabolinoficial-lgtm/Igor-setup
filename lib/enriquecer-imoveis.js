// lib/enriquecer-imoveis.js — Completa os campos vazios dos imóveis (bairro, quartos,
// banheiros, área, características) extraindo da descrição via IA. NÃO sobrescreve o que
// já existe e NÃO inventa (null quando o texto não menciona).
'use strict';

const { db } = require('../db');
const { gerarTexto, extrairJson } = require('../agentes/ia');

const vazio = (v) => v === null || v === undefined || v === '' || v === 0;

function montarPrompt(imovel) {
    return `Você extrai dados estruturados de anúncios imobiliários do litoral de Santa Catarina.
Dado o TÍTULO e a DESCRIÇÃO, extraia APENAS o que estiver EXPLÍCITO no texto. NÃO invente.

Responda SOMENTE com JSON puro (sem markdown):
{"bairro": "...", "quartos": N, "banheiros": N, "area_m2": N, "caracteristicas": ["...","..."]}

REGRAS:
- Use null em qualquer campo que o texto não mencione claramente. É melhor null do que chutar.
- bairro: a localidade/bairro citado (ex: Encantada, Praia do Rosa, Campo Duna, Ibiraquera, Garopaba, Imbituba, Ferrugem, Silveira, Ouvidor). Só se aparecer no texto.
- quartos / banheiros: número inteiro. "suíte" conta como quarto. Se disser "2 quartos e 1 suíte" = 3.
- area_m2: área construída em m² (só o número). Ignore área do terreno se houver as duas.
- caracteristicas: até 6 diferenciais reais citados (ex: "ofurô", "churrasqueira", "vista para o mar", "piscina", "cozinha gourmet", "garagem"). Frases curtas.

TÍTULO: ${imovel.titulo || ''}
DESCRIÇÃO: ${(imovel.descricao || '').slice(0, 2000)}

JSON:`;
}

// Enriquece UM imóvel: extrai da descrição e preenche só os campos vazios. Retorna o que mudou.
async function enriquecerImovel(imovel) {
    if (!imovel.descricao || imovel.descricao.length < 30) {
        return { ok: false, motivo: 'descrição curta/ausente' };
    }
    const r = await gerarTexto(montarPrompt(imovel), { modelo: 'llama-3.3-70b-versatile' });
    if (!r) return { ok: false, motivo: 'LLM indisponível' };

    let ext = null;
    try { ext = JSON.parse(r.texto.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()); }
    catch { ext = extrairJson(r.texto); }
    if (!ext) return { ok: false, motivo: 'JSON inválido' };

    // Decodifica caracteristicas atuais
    let caracAtual = [];
    try { caracAtual = imovel.caracteristicas ? (Array.isArray(imovel.caracteristicas) ? imovel.caracteristicas : JSON.parse(imovel.caracteristicas)) : []; } catch {}

    const sets = [];
    const params = [];
    const mudou = {};

    if (vazio(imovel.bairro) && ext.bairro && typeof ext.bairro === 'string') {
        sets.push('bairro = ?'); params.push(ext.bairro.trim()); mudou.bairro = ext.bairro.trim();
    }
    if (vazio(imovel.quartos) && Number.isInteger(ext.quartos) && ext.quartos > 0) {
        sets.push('quartos = ?'); params.push(ext.quartos); mudou.quartos = ext.quartos;
    }
    if (vazio(imovel.banheiros) && Number.isInteger(ext.banheiros) && ext.banheiros > 0) {
        sets.push('banheiros = ?'); params.push(ext.banheiros); mudou.banheiros = ext.banheiros;
    }
    if (vazio(imovel.area_m2) && Number(ext.area_m2) > 0) {
        sets.push('area_m2 = ?'); params.push(Number(ext.area_m2)); mudou.area_m2 = Number(ext.area_m2);
    }
    if ((!caracAtual || !caracAtual.length) && Array.isArray(ext.caracteristicas) && ext.caracteristicas.length) {
        const lista = ext.caracteristicas.filter(c => typeof c === 'string').slice(0, 6);
        sets.push('caracteristicas = ?'); params.push(JSON.stringify(lista)); mudou.caracteristicas = lista;
    }

    if (!sets.length) return { ok: true, mudou: {}, nota: 'nada a preencher' };

    params.push(imovel.id);
    db.prepare(`UPDATE imoveis SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return { ok: true, mudou };
}

module.exports = { enriquecerImovel };
