const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

function basePath() {
    return process.env.OBSIDIAN_PATH || path.join(__dirname, '..', 'cerebro');
}

function dentroDaBase(absoluto) {
    const base = path.resolve(basePath());
    const alvo = path.resolve(absoluto);
    return alvo.startsWith(base);
}

// === Parser de YAML frontmatter (mínimo, suficiente pro Esquema Neural) ===
function parseFrontmatter(texto) {
    const m = texto.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!m) return { frontmatter: {}, corpo: texto };
    const yaml = m[1];
    const corpo = m[2];
    const fm = {};
    let chaveAtual = null;
    for (const linha of yaml.split('\n')) {
        const lista = linha.match(/^\s+-\s+(.+)$/);
        if (lista && chaveAtual) {
            (fm[chaveAtual] = fm[chaveAtual] || []).push(lista[1].trim());
            continue;
        }
        const par = linha.match(/^([a-zA-Z_]\w*):\s*(.*)$/);
        if (par) {
            const k = par[1], v = par[2];
            if (v === '' || v == null) {
                fm[k] = [];
                chaveAtual = k;
            } else {
                fm[k] = v.trim();
                chaveAtual = null;
            }
        }
    }
    return { frontmatter: fm, corpo };
}

// === Extrai sinapses (conecta_com) com tipo ===
// Formato esperado nas linhas: "[[Nota]] # TipoSinapse"
function extrairSinapses(fm) {
    const out = [];
    const lista = fm.conecta_com;
    if (!Array.isArray(lista)) return out;
    for (const item of lista) {
        const m = item.match(/\[\[([^\]]+)\]\](?:\s*#\s*(.+))?/);
        if (m) out.push({ alvo: m[1].trim(), sinapse: (m[2] || 'relacao').trim() });
    }
    return out;
}

// === Walk recursivo no vault ===
function listarRecursivo(dir, prefixo = '') {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.name.startsWith('.')) continue;
        const completo = path.join(dir, item.name);
        const rel = path.posix.join(prefixo, item.name);
        if (item.isDirectory()) {
            out.push(...listarRecursivo(completo, rel));
        } else if (item.name.toLowerCase().endsWith('.md')) {
            const stat = fs.statSync(completo);
            out.push({ arquivo: rel, caminho: completo, tamanho: stat.size, modificado_em: stat.mtime.toISOString() });
        }
    }
    return out;
}

// === Carrega todas as notas com frontmatter ===
function carregarNotas() {
    const arquivos = listarRecursivo(basePath());
    const notas = [];
    for (const a of arquivos) {
        try {
            const conteudo = fs.readFileSync(a.caminho, 'utf8');
            const { frontmatter, corpo } = parseFrontmatter(conteudo);
            const sinapses = extrairSinapses(frontmatter);
            const nome = path.basename(a.arquivo, '.md');
            notas.push({
                id: nome,
                arquivo: a.arquivo,
                titulo: nome.replace(/_/g, ' '),
                tipo: frontmatter.tipo || null,
                projeto: frontmatter.projeto || null,
                status: frontmatter.status || null,
                sinapses,
                corpo: corpo.slice(0, 4000),
                modificado_em: a.modificado_em
            });
        } catch (_) {}
    }
    return notas;
}

// === Constrói o grafo: nós (notas) + arestas (sinapses) ===
function montarGrafo(notas) {
    const nos = notas.map(n => ({
        id: n.id,
        titulo: n.titulo,
        tipo: n.tipo,
        projeto: n.projeto,
        arquivo: n.arquivo
    }));
    const arestas = [];
    const idsValidos = new Set(nos.map(n => n.id));
    for (const n of notas) {
        for (const s of n.sinapses) {
            // alvo pode ter espaços ou underscores — normaliza
            const alvoNormalizado = s.alvo.replace(/\s+/g, '_');
            const alvoId = idsValidos.has(s.alvo) ? s.alvo
                          : idsValidos.has(alvoNormalizado) ? alvoNormalizado
                          : null;
            arestas.push({
                de: n.id,
                para: alvoId || s.alvo,
                sinapse: s.sinapse,
                resolvida: !!alvoId
            });
        }
    }
    return { nos, arestas };
}

// === BFS pra encontrar todas as notas conectadas a um hub (até depth N) ===
function notasConectadas(hubId, notas, profundidadeMax = 2) {
    const porId = Object.fromEntries(notas.map(n => [n.id, n]));
    const visitadas = new Set();
    const fila = [{ id: hubId, profundidade: 0 }];
    const resultado = [];
    while (fila.length) {
        const { id, profundidade } = fila.shift();
        if (visitadas.has(id) || profundidade > profundidadeMax) continue;
        visitadas.add(id);
        const nota = porId[id];
        if (!nota) continue;
        resultado.push({ ...nota, profundidade });
        for (const s of nota.sinapses) {
            const alvoNorm = s.alvo.replace(/\s+/g, '_');
            const alvoId = porId[s.alvo] ? s.alvo : porId[alvoNorm] ? alvoNorm : null;
            if (alvoId) fila.push({ id: alvoId, profundidade: profundidade + 1 });
        }
        // notas que apontam pra esta também (backlinks)
        for (const outra of notas) {
            if (visitadas.has(outra.id)) continue;
            if (outra.sinapses.some(s => s.alvo === id || s.alvo.replace(/\s+/g, '_') === id)) {
                fila.push({ id: outra.id, profundidade: profundidade + 1 });
            }
        }
    }
    return resultado;
}

// ═══════════════════════ ROTAS ═══════════════════════

router.get('/', (_req, res) => {
    const base = basePath();
    res.json({ base, arquivos: listarRecursivo(base).map(a => ({ arquivo: a.arquivo, modificado_em: a.modificado_em })) });
});

router.get('/grafo', (_req, res) => {
    const notas = carregarNotas();
    const grafo = montarGrafo(notas);
    const distrTipo = notas.reduce((acc, n) => { acc[n.tipo || 'sem_tipo'] = (acc[n.tipo || 'sem_tipo'] || 0) + 1; return acc; }, {});
    res.json({
        total_notas: notas.length,
        total_sinapses: grafo.arestas.length,
        sinapses_resolvidas: grafo.arestas.filter(a => a.resolvida).length,
        distribuicao_tipo: distrTipo,
        ...grafo
    });
});

router.get('/hub/:nome', (req, res) => {
    const notas = carregarNotas();
    const conectadas = notasConectadas(req.params.nome, notas, Number(req.query.profundidade || 2));
    if (!conectadas.length) return res.status(404).json({ erro: `Hub '${req.params.nome}' não encontrado` });
    res.json({ hub: req.params.nome, total: conectadas.length, notas: conectadas });
});

router.get('/buscar', (req, res) => {
    const termo = (req.query.q || '').toLowerCase().trim();
    if (!termo) return res.json({ resultados: [] });
    const notas = carregarNotas();
    const resultados = notas
        .filter(n => n.corpo.toLowerCase().includes(termo) || n.titulo.toLowerCase().includes(termo))
        .map(n => ({
            id: n.id, titulo: n.titulo, tipo: n.tipo,
            trecho: extrairTrecho(n.corpo, termo)
        }));
    res.json({ termo, total: resultados.length, resultados });
});

function extrairTrecho(texto, termo) {
    const i = texto.toLowerCase().indexOf(termo);
    if (i < 0) return texto.slice(0, 200);
    return '…' + texto.slice(Math.max(0, i - 80), i + 200) + '…';
}

router.get('/arquivo/{*caminho}', (req, res) => {
    const arquivo = Array.isArray(req.params.caminho) ? req.params.caminho.join('/') : (req.params.caminho || '');
    const completo = path.join(basePath(), arquivo);
    if (!dentroDaBase(completo)) return res.status(403).json({ erro: 'Caminho fora do Cérebro' });
    if (!fs.existsSync(completo)) return res.status(404).json({ erro: 'Arquivo não encontrado' });
    const conteudo = fs.readFileSync(completo, 'utf8');
    const { frontmatter, corpo } = parseFrontmatter(conteudo);
    res.json({ arquivo, frontmatter, sinapses: extrairSinapses(frontmatter), corpo });
});

// === Igor escreve no Cérebro próprio (vault Igor_Babolin_Brain) ===
function registrarSinapse({ titulo, tipo = 'log', conteudo, conectaCom = ['Igor_Babolin'], pasta = 'Logs_Neurais' }) {
    const base = basePath();
    if (!base || !fs.existsSync(base)) return null;
    const dir = path.join(base, pasta);
    fs.mkdirSync(dir, { recursive: true });
    const slug = titulo.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nome = `${stamp}_${slug}.md`;
    const sinapsesYaml = conectaCom.map(c => `  - [[${c}]] # Log_de`).join('\n');
    const md = `---
projeto: Igor_Babolin
tipo: ${tipo}
data: ${new Date().toISOString().slice(0, 10)}
origem: igor-neural-system
conecta_com:
${sinapsesYaml}
---

# ${titulo}

${conteudo}

---
Parte de: [[Igor_Babolin]]
`;
    fs.writeFileSync(path.join(dir, nome), md, 'utf8');
    return path.posix.join(pasta, nome);
}

router.post('/registrar', (req, res) => {
    const { titulo, conteudo, conecta_com, tipo } = req.body || {};
    if (!titulo || !conteudo) return res.status(400).json({ erro: 'titulo e conteudo obrigatórios' });
    const arquivo = registrarSinapse({
        titulo,
        conteudo,
        conectaCom: Array.isArray(conecta_com) ? conecta_com : ['Igor_Babolin'],
        tipo: tipo || 'log'
    });
    if (!arquivo) return res.status(500).json({ erro: 'Cérebro Obsidian indisponível' });
    res.json({ ok: true, arquivo });
});

// Atalho pros agentes injetarem o DNA da imobiliária nos prompts.
// Retorna até `maxChars` do hub `Igor_Babolin` e suas notas conectadas (profundidade 1).
// Cache de 5min pra não reler vault a cada qualificação.
let cacheDNA = null;
let cacheDNAExpiraEm = 0;

function contextoDNA(maxChars = 2500) {
    const agora = Date.now();
    if (cacheDNA && agora < cacheDNAExpiraEm) return cacheDNA;
    try {
        const notas = carregarNotas();
        const conectadas = notasConectadas('Igor_Babolin', notas, 1);
        if (!conectadas.length) {
            cacheDNA = '';
        } else {
            const pedacos = conectadas.slice(0, 6).map(n =>
                `## ${n.titulo} [${n.tipo || 'sem_tipo'}]\n${n.corpo.slice(0, 500)}`
            );
            cacheDNA = pedacos.join('\n\n').slice(0, maxChars);
        }
    } catch {
        cacheDNA = '';
    }
    cacheDNAExpiraEm = agora + 5 * 60 * 1000;
    return cacheDNA;
}

module.exports = { router, registrarSinapse, carregarNotas, montarGrafo, notasConectadas, contextoDNA };
