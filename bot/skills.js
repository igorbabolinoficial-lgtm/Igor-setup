// Skills sob demanda — padrão Hermes pra Igor.
// Cada skill tem matchers (palavras-chave). Quando texto bate, executa o prompt_template via LLM.
// Skills dormem por padrão (não consomem contexto) e só acordam quando matcheadas.

const { db, registrarLog } = require('../db');
const { gerarTexto, extrairJson, temAlgumLLM } = require('../agentes/ia');

// Normaliza texto pra match (lowercase, sem acentos, sem pontuação dupla)
function normalizar(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Tenta casar texto contra alguma skill ativa. Retorna { skill, input } ou null.
// input = texto sem o trigger (pra alimentar o prompt). Se trigger não dá pra remover, usa texto inteiro.
function matchSkill(texto) {
    if (!texto) return null;
    const norm = normalizar(texto);

    const skills = db.prepare(`SELECT * FROM skills WHERE ativa = 1`).all();
    for (const s of skills) {
        let matchers = [];
        try { matchers = JSON.parse(s.matchers || '[]'); } catch (_) {}
        for (const m of matchers) {
            const mNorm = normalizar(m);
            if (norm.includes(mNorm)) {
                // Remove o trigger do texto, sobra "o que" o usuário quer
                const idx = norm.indexOf(mNorm);
                const sobra = (texto.slice(0, idx) + texto.slice(idx + m.length)).trim().replace(/^[:,.\s-]+/, '');
                return { skill: s, input: sobra || texto };
            }
        }
    }
    return null;
}

// Executa uma skill. Devolve { ok, output, ms } ou { ok:false, erro }.
// `extra` = contexto extra (lead, imóvel atual, etc) pra mesclar no prompt.
async function executarSkill(slugOrSkill, input, extra = {}) {
    const skill = typeof slugOrSkill === 'string'
        ? db.prepare('SELECT * FROM skills WHERE slug = ? AND ativa = 1').get(slugOrSkill)
        : slugOrSkill;
    if (!skill) return { ok: false, erro: `skill nao encontrada: ${slugOrSkill}` };

    const inicio = Date.now();
    let output = '';
    let sucesso = 1;
    let erro = null;

    try {
        if (skill.prompt_template === '__FIND_SKILLS__') {
            // Caso especial: busca semantica nas skills, devolve markdown formatado
            output = await findSkills(input);
        } else if (skill.slug === 'creator') {
            output = await executarCreator(input);
        } else {
            if (!temAlgumLLM()) throw new Error('LLM nao configurado');
            const prompt = skill.prompt_template.replace(/\{\{\s*input\s*\}\}/gi, input || '');
            // Mescla contexto extra (ex: dados do lead)
            const ctxStr = extra && Object.keys(extra).length
                ? `\n\n# CONTEXTO EXTRA\n${JSON.stringify(extra, null, 2)}`
                : '';
            const r = await gerarTexto(prompt + ctxStr);
            if (!r) throw new Error('LLM retornou null');
            output = r.texto;
        }
    } catch (e) {
        sucesso = 0;
        erro = e.message;
        output = `Erro na skill: ${e.message}`;
    }

    const ms = Date.now() - inicio;
    db.prepare(`
        INSERT INTO skill_execucoes (skill_id, entrada, contexto, output, sucesso, erro, ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(skill.id, input, JSON.stringify(extra || {}), output, sucesso, erro, ms);

    registrarLog({
        agente: 'skills', nivel: sucesso ? 'sucesso' : 'erro',
        mensagem: `${skill.slug}: ${sucesso ? 'OK' : erro}`,
        contexto: { skill_id: skill.id, ms, input_len: (input || '').length, output_len: output.length }
    });

    return { ok: !!sucesso, output, ms, skill: { id: skill.id, slug: skill.slug, nome: skill.nome } };
}

async function findSkills(busca) {
    const ativas = db.prepare(`SELECT slug, nome, descricao FROM skills WHERE ativa = 1`).all();
    if (!busca || !busca.trim()) {
        // Sem busca = lista todas
        return `*Skills disponiveis (${ativas.length}):*\n\n` + ativas.map(s => `• **${s.nome}** \`${s.slug}\` — ${s.descricao}`).join('\n');
    }
    // Busca primeiro via FTS5, fallback LIKE
    let matches = [];
    try {
        matches = db.prepare(`
            SELECT s.* FROM skills_fts f
            JOIN skills s ON s.id = f.rowid
            WHERE skills_fts MATCH ? AND s.ativa = 1
            ORDER BY rank LIMIT 5
        `).all(busca);
    } catch (_) {
        const like = `%${busca}%`;
        matches = db.prepare(`
            SELECT * FROM skills
            WHERE ativa = 1 AND (LOWER(descricao) LIKE LOWER(?) OR LOWER(nome) LIKE LOWER(?))
            LIMIT 5
        `).all(like, like);
    }
    if (!matches.length) return `Nenhuma skill encontrada pra "${busca}". Use \`/skills\` pra ver todas.`;
    return `*${matches.length} skill(s) encontrada(s) pra "${busca}":*\n\n` +
        matches.map(s => `• **${s.nome}** \`${s.slug}\` — ${s.descricao}`).join('\n');
}

async function executarCreator(descricao) {
    if (!temAlgumLLM()) return 'LLM nao configurado — Skill Creator precisa de Groq/Gemini/Anthropic';
    const prompt = `Você é o Skill Creator do Igor Babolin. Crie uma nova skill a partir da descrição abaixo.

Devolva APENAS JSON estrito (nada antes nem depois):
{
  "slug": "kebab-case-curto",
  "nome": "Title Case Curto",
  "descricao": "1 frase explicando o que faz",
  "prompt_template": "prompt com {{input}} como placeholder do input do usuario",
  "matchers": ["palavra1", "palavra2", "frase curta"]
}

DESCRIÇÃO DA SKILL: ${descricao}`;

    const r = await gerarTexto(prompt);
    if (!r) return 'LLM falhou ao gerar skill';
    const json = extrairJson(r.texto);
    if (!json || !json.slug) return 'LLM retornou JSON invalido. Tenta descrever de novo, mais especifico.';

    // Sanitiza slug
    const slug = String(json.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 50);
    try {
        db.prepare(`
            INSERT INTO skills (slug, nome, descricao, prompt_template, matchers, seed)
            VALUES (?, ?, ?, ?, ?, 0)
        `).run(slug, json.nome, json.descricao, json.prompt_template, JSON.stringify(json.matchers || []));
        return `✓ Skill criada: **${json.nome}** \`${slug}\`\n\n_${json.descricao}_\n\nMatchers: ${(json.matchers || []).join(', ')}\n\nUse com \`/skill ${slug} <input>\``;
    } catch (e) {
        if (e.message.includes('UNIQUE')) return `Skill com slug \`${slug}\` ja existe. Escolha outro nome.`;
        return `Erro ao criar: ${e.message}`;
    }
}

function listarSkills(incluirInativas = false) {
    const where = incluirInativas ? '' : 'WHERE ativa = 1';
    return db.prepare(`SELECT id, slug, nome, descricao, ativa, seed, criada_em FROM skills ${where} ORDER BY seed DESC, nome ASC`).all();
}

function buscarSkill(slug) {
    const s = db.prepare(`SELECT * FROM skills WHERE slug = ?`).get(slug);
    if (!s) return null;
    return { ...s, matchers: JSON.parse(s.matchers || '[]') };
}

function criarSkill({ slug, nome, descricao, prompt_template, matchers = [] }) {
    const r = db.prepare(`
        INSERT INTO skills (slug, nome, descricao, prompt_template, matchers, seed)
        VALUES (?, ?, ?, ?, ?, 0)
    `).run(slug, nome, descricao, prompt_template, JSON.stringify(matchers));
    return { id: r.lastInsertRowid, slug };
}

module.exports = { matchSkill, executarSkill, listarSkills, buscarSkill, criarSkill, findSkills };
