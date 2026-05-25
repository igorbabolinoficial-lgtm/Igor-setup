#!/usr/bin/env node
/**
 * Migrator — importa imóveis do imobiliariapraiadorosa.com.br
 * Lê sitemap, scrape cada listing com cheerio, salva no banco e baixa as fotos.
 *
 * Uso: node migrator.js [--max=N] [--dry] [--so-fotos=ID]
 *   --max=N        limita N imóveis (debug)
 *   --dry          não escreve no banco nem baixa fotos
 *   --so-fotos=ID  re-baixa fotos só de 1 imóvel pelo data-id
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { db, registrarLog } = require('./db');

const SITEMAP    = 'http://imobiliariapraiadorosa.com.br/sitemap.xml';
// Fallback usado quando o sitemap está desatualizado (caso real: 48 URLs no XML vs 156 na pagina).
const LISTAGEM   = 'https://imobiliariapraiadorosa.com.br/property';
// Em prod: ASSETS_DIR=/data/assets/imoveis (volume Coolify, persiste entre redeploys).
// Em dev: fallback pra public/assets/imoveis (caminho local antigo).
const ASSETS_DIR = process.env.ASSETS_DIR || path.join(__dirname, 'public', 'assets', 'imoveis');
const UA         = 'Mozilla/5.0 (Igor Neural Migrator)';

function flag(nome) {
    const a = process.argv.find(a => a.startsWith(`--${nome}`));
    if (!a) return null;
    if (a.includes('=')) return a.split('=')[1];
    return true;
}

async function buscar(url, opts = {}) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', ...opts });
    return { html: await r.text(), finalUrl: r.url, status: r.status };
}

async function baixarBinario(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}

function decodeEnts(s) {
    return (s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Remove referencias ao contato do site original (concorrente). Mantemos o texto descritivo,
// trocando telefones/emails pelos do Igor pra evitar que cliente do babolin.tech ligue pra outro corretor.
function sanitizarTexto(s) {
    if (!s) return s;
    const fones = [
        /\+?55[\s.\-]?\(?48\)?[\s.\-]?9\s?9145[\s.\-]?0077/g,
        /\(?48\)?[\s.\-]?9\s?9145[\s.\-]?0077/g,
        /9\s?9145[\s.\-]?0077/g,
        /48991450077/g,
        /5548991450077/g,
    ];
    let t = s;
    for (const r of fones) t = t.replace(r, '(48) 9149-3622');
    t = t.replace(/contato@imobiliariapraiadorosa\.com\.br/gi, 'contato@babolin.tech');
    return t;
}

function parsePreco(texto) {
    if (!texto) return null;
    let limpo = texto.replace(/[^\d.,]/g, '');
    if (!limpo) return null;
    if (limpo.includes(',')) {
        // Formato BR: ponto = milhar, vírgula = decimal
        limpo = limpo.replace(/\./g, '').replace(',', '.');
    } else {
        // Sem vírgula: pontos são separadores de milhar (assume integer BR)
        limpo = limpo.replace(/\./g, '');
    }
    const n = parseFloat(limpo);
    return isNaN(n) ? null : n;
}

function parsePropriedade(html, urlOrigem) {
    const $ = cheerio.load(html);
    const slider = $('.property_slider').first();
    const titulo = slider.attr('data-title');
    const slug   = slider.attr('data-url');
    const idHash = slider.attr('data-id');
    if (!titulo || !slug || !idHash) return null;

    const precoBruto = decodeEnts($('.price-block-btn').first().text().trim());
    const preco = parsePreco(precoBruto);

    // Preserva parágrafos: converte <br> e </p> em \n antes de pegar texto
    const descHtml = ($('.prop_desc').html() || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n');
    const descTexto = cheerio.load('<div>' + descHtml + '</div>')('div').text()
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 6000);
    const descricao = sanitizarTexto(descTexto);

    // Fotos: tudo de /uploads/media/ exceto LOGO/logo, deduplicado
    const fotosUrlsSet = new Set();
    $('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (!src) return;
        if (!src.includes('/uploads/media/')) return;
        if (/LOGO|logo/i.test(src)) return;
        // normaliza: tira variantes -800X500, -1024X768 etc.
        fotosUrlsSet.add(src);
    });
    const fotosUrls = [...fotosUrlsSet];

    // Inferir tipo a partir do slug
    const slugLower = slug.toLowerCase();
    let tipo = 'outro';
    if (/casa/.test(slugLower))                tipo = 'casa';
    else if (/apto|apartamento/.test(slugLower)) tipo = 'apartamento';
    else if (/terreno|lote/.test(slugLower))    tipo = 'terreno';
    else if (/sitio/.test(slugLower))           tipo = 'sitio';
    else if (/cobertura/.test(slugLower))       tipo = 'cobertura';
    else if (/loja|comercial/.test(slugLower))  tipo = 'comercial';
    else if (/residencial|condominio/.test(slugLower)) tipo = 'residencial';

    // Bairro a partir do slug (heurística)
    let bairro = null;
    if (/ibiraquera/.test(slugLower)) bairro = 'Ibiraquera';
    else if (/rosa-(norte|sul|internacional)/.test(slugLower)) bairro = 'Praia do Rosa';
    else if (/rosa/.test(slugLower)) bairro = 'Praia do Rosa';
    else if (/vigia/.test(slugLower)) bairro = 'Praia da Vigia';

    // ---- Campos enriquecidos (v2) ----
    const descLower = (descricao || '').toLowerCase();

    // Quartos / Suítes / Banheiros / Garagem / Área — tenta selectors primeiro, fallback regex na desc
    function extrairInt(seletores, regexes, html2) {
        const $2 = cheerio.load(html2);
        for (const s of seletores) {
            const t = $2(s).first().text().trim();
            const n = parseInt(t, 10);
            if (!isNaN(n) && n > 0) return n;
        }
        for (const rx of regexes) {
            const m = descLower.match(rx);
            if (m) { const n = parseInt(m[1], 10); if (!isNaN(n)) return n; }
        }
        return null;
    }
    function extrairFloat(seletores, regexes, html2) {
        const $2 = cheerio.load(html2);
        for (const s of seletores) {
            const t = $2(s).first().text().replace(/[^\d.,]/g, '').replace(',', '.');
            const n = parseFloat(t);
            if (!isNaN(n) && n > 0) return n;
        }
        for (const rx of regexes) {
            const m = descLower.match(rx);
            if (m) { const n = parseFloat(m[1].replace(',', '.')); if (!isNaN(n)) return n; }
        }
        return null;
    }

    const quartos = extrairInt(
        ['.dormitorios', '.quartos', '[class*="bedroom"]', '[title*="dormit"]', '[title*="quarto"]'],
        [/(\d+)\s*(?:dormit[oó]rio|quarto|suite?)/],
        html
    );
    const suites = extrairInt(
        ['.suites', '[class*="suite"]', '[title*="su[ií]te"]'],
        [/(\d+)\s*su[ií]te/],
        html
    );
    const banheiros = extrairInt(
        ['.banheiros', '[class*="bathroom"]', '[title*="banheiro"]'],
        [/(\d+)\s*banheiro/],
        html
    );
    const garagem = extrairInt(
        ['.garagem', '.vagas', '[class*="garage"]', '[class*="vaga"]', '[title*="garagem"]', '[title*="vaga"]'],
        [/(\d+)\s*(?:vaga|garagem)/],
        html
    );
    const area_m2 = extrairFloat(
        ['.area', '.m2', '[class*="area"]', '[title*="área"]', '[title*="m²"]'],
        [/(\d+(?:[,.]\d+)?)\s*m[²2]/],
        html
    );
    const area_terreno_m2 = extrairFloat(
        ['.area-terreno', '[class*="terreno"]'],
        [/[áa]rea\s*(?:do\s*)?terreno[:\s]+(\d+(?:[,.]\d+)?)\s*m[²2]/],
        html
    );

    // Tipo de negócio
    let negocio = 'venda';
    if (/temporada|aluguel\s*de\s*temporada|short.?stay/.test(descLower)) negocio = 'temporada';
    else if (/loca[çc][aã]o|aluguel|alugar/.test(descLower)) negocio = 'locacao';
    else if (/permuta/.test(descLower)) negocio = 'permuta';

    // Forma de pagamento
    const formas = [];
    if (/financiamento|financiado|financiar/.test(descLower)) formas.push('financiamento');
    if (/fgts/.test(descLower)) formas.push('fgts');
    if (/[àa]\s*vista|avista/.test(descLower)) formas.push('avista');
    if (/permuta/.test(descLower)) formas.push('permuta');
    if (/consorcio|consórcio/.test(descLower)) formas.push('consorcio');
    const forma_pagamento = formas.length ? formas : null;

    // IPTU anual
    let iptu_anual = null;
    const mIptu = descLower.match(/iptu[:\s]+r?\$?\s*([\d.,]+)/);
    if (mIptu) iptu_anual = parsePreco(mIptu[1]);

    // Condomínio mensal
    let condominio_mensal = null;
    const mCond = descLower.match(/condom[íi]nio[:\s]+r?\$?\s*([\d.,]+)/);
    if (mCond) condominio_mensal = parsePreco(mCond[1]);

    // Aceita FGTS
    const aceita_fgts = /fgts/.test(descLower) ? 1 : 0;

    // Código de referência
    let codigo_ref = null;
    const mCod = html.match(/(?:c[oó]digo|ref(?:er[eê]ncia)?|cod)[:\s#.]+([A-Z0-9\-]+)/i);
    if (mCod) codigo_ref = mCod[1];

    // Características (amenidades)
    const AMENIDADES = [
        ['piscina', 'piscina'],
        ['churrasqueira', 'churrasqueira'],
        ['sauna', 'sauna'],
        ['vista[\\s-]?mar', 'vista mar'],
        ['p[eé]\\s*na\\s*areia|beira[\\s-]?mar', 'beira mar'],
        ['academia', 'academia'],
        ['elevador', 'elevador'],
        ['portaria\\s*24h', 'portaria 24h'],
        ['playground', 'playground'],
        ['varanda\\s*gourmet', 'varanda gourmet'],
        ['area\\s*gourmet|[áa]rea\\s*gourmet', 'área gourmet'],
        ['mobiliado|mobili[áa]do', 'mobiliado'],
        ['ar.condicionado', 'ar condicionado'],
        ['energia\\s*solar', 'energia solar'],
    ];
    const caracteristicas = AMENIDADES
        .filter(([rx]) => new RegExp(rx).test(descLower))
        .map(([, nome]) => nome);

    return {
        id: idHash, slug, titulo, descricao, preco, tipo, bairro, fotosUrls, urlOrigem,
        quartos, suites, banheiros, garagem, area_m2, area_terreno_m2,
        negocio, forma_pagamento, iptu_anual, condominio_mensal,
        aceita_fgts, codigo_ref,
        caracteristicas: caracteristicas.length ? caracteristicas : null,
    };
}

function ehHomepage(html) {
    // Quando a propriedade não existe mais, redireciona pra home: não tem .property_slider
    return !html.includes('property_slider');
}

// Lê URLs de imóveis combinando sitemap.xml (rápido) + listagem /property (cobre o gap quando o sitemap está desatualizado).
async function coletarUrls() {
    const set = new Set();
    try {
        const { html: xml } = await buscar(SITEMAP);
        [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
            .map(m => m[1].trim())
            .filter(u => /\/property\/.+~\d+/.test(u))
            .forEach(u => set.add(u.replace(/^http:\/\//, 'https://')));
    } catch (e) {
        console.warn('[migrator] sitemap falhou:', e.message);
    }
    try {
        const { html } = await buscar(LISTAGEM);
        [...html.matchAll(/href="(https?:\/\/imobiliariapraiadorosa\.com\.br\/property\/[^"]+~\d+)"/g)]
            .map(m => m[1])
            .forEach(u => set.add(u.replace(/^http:\/\//, 'https://')));
    } catch (e) {
        console.warn('[migrator] listagem falhou:', e.message);
    }
    return [...set];
}

async function migrarImovel(url, log, opts = {}) {
    const { html, status } = await buscar(url);
    if (status !== 200) { log.pulados.push({ url, motivo: `HTTP ${status}` }); return; }
    if (ehHomepage(html)) { log.pulados.push({ url, motivo: 'redirect pra home (offline)' }); return; }

    const data = parsePropriedade(html, url);
    if (!data) { log.pulados.push({ url, motivo: 'sem .property_slider' }); return; }

    const dir = path.join(ASSETS_DIR, data.id);
    if (!opts.dry) fs.mkdirSync(dir, { recursive: true });

    const fotosLocais = [];
    const CONCURRENCY_LIMIT = 5; // Baixa 5 fotos por vez
    const chunks = [];
    for (let i = 0; i < data.fotosUrls.length; i += CONCURRENCY_LIMIT) {
        chunks.push(data.fotosUrls.slice(i, i + CONCURRENCY_LIMIT));
    }

    let fotoIdx = 0;
    for (const chunk of chunks) {
        await Promise.all(chunk.map(async (u) => {
            const currentIdx = fotoIdx++;
            const ext = (u.match(/\.[a-z]{3,4}(\?|$)/i) || ['.jpg'])[0].split('?')[0];
            const localFile = path.join(dir, `${currentIdx}${ext}`);
            const localPath = `/assets/imoveis/${data.id}/${currentIdx}${ext}`;
            
            if (!opts.dry && opts.skipExistentes && fs.existsSync(localFile)) {
                fotosLocais.push(localPath);
                return;
            }

            try {
                if (!opts.dry) {
                    const buf = await baixarBinario(u);
                    fs.writeFileSync(localFile, buf);
                }
                fotosLocais.push(localPath);
            } catch (e) {
                log.fotosErr.push({ imovel: data.id, url: u, erro: e.message });
            }
        }));
        // Pequena pausa entre chunks para não ser bloqueado por rate limit do servidor
        await new Promise(r => setTimeout(r, 150));
    }

    if (!opts.dry) {
        db.prepare(`
            INSERT INTO imoveis (
                id, slug, titulo, descricao, preco, tipo, bairro, fotos, url_origem,
                quartos, suites, banheiros, garagem, area_m2, area_terreno_m2,
                negocio, forma_pagamento, iptu_anual, condominio_mensal,
                aceita_fgts, codigo_ref, caracteristicas
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                titulo=excluded.titulo, descricao=excluded.descricao,
                preco=excluded.preco, tipo=excluded.tipo, bairro=excluded.bairro,
                fotos=excluded.fotos, importado_em=datetime('now'),
                quartos=excluded.quartos, suites=excluded.suites,
                banheiros=excluded.banheiros, garagem=excluded.garagem,
                area_m2=excluded.area_m2, area_terreno_m2=excluded.area_terreno_m2,
                negocio=excluded.negocio, forma_pagamento=excluded.forma_pagamento,
                iptu_anual=excluded.iptu_anual, condominio_mensal=excluded.condominio_mensal,
                aceita_fgts=excluded.aceita_fgts, codigo_ref=excluded.codigo_ref,
                caracteristicas=excluded.caracteristicas
        `).run(
            data.id, data.slug, data.titulo, data.descricao,
            data.preco, data.tipo, data.bairro,
            JSON.stringify(fotosLocais), data.urlOrigem,
            data.quartos, data.suites, data.banheiros, data.garagem,
            data.area_m2, data.area_terreno_m2,
            data.negocio,
            data.forma_pagamento ? JSON.stringify(data.forma_pagamento) : null,
            data.iptu_anual, data.condominio_mensal,
            data.aceita_fgts, data.codigo_ref,
            data.caracteristicas ? JSON.stringify(data.caracteristicas) : null
        );
    }

    log.sucesso.push({
        id: data.id, titulo: data.titulo, preco: data.preco,
        fotos: fotosLocais.length
    });
}

async function main() {
    const max = Number(flag('max')) || Infinity;
    const dry = !!flag('dry');
    const skipExistentes = !!flag('skip-fotos') || !!flag('rapido');

    if (!dry) fs.mkdirSync(ASSETS_DIR, { recursive: true });
    if (skipExistentes) console.log('[migrator] modo rápido: pulando fotos já baixadas');

    console.log(`[migrator] Coletando URLs (sitemap + listagem)`);
    let urls = await coletarUrls();

    console.log(`[migrator] ${urls.length} URLs de imóvel detectadas`);
    urls = urls.slice(0, max);

    const log = { sucesso: [], pulados: [], fotosErr: [] };

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        process.stdout.write(`[${i + 1}/${urls.length}] `);
        try {
            await migrarImovel(url, log, { dry, skipExistentes });
            const ult = log.sucesso[log.sucesso.length - 1];
            if (ult && ult.titulo) console.log(`✓ ${ult.titulo} — R$ ${ult.preco || '?'} — ${ult.fotos} fotos`);
            else console.log('✗ pulado');
        } catch (e) {
            console.log(`✗ erro: ${e.message}`);
            log.pulados.push({ url, motivo: e.message });
        }
        await new Promise(r => setTimeout(r, 400));
    }

    console.log('\n=== RELATÓRIO ===');
    console.log(`✓ Migrados com sucesso: ${log.sucesso.length}`);
    console.log(`✗ Pulados: ${log.pulados.length}`);
    console.log(`📷 Fotos com erro: ${log.fotosErr.length}`);
    if (!dry) {
        const total = db.prepare('SELECT COUNT(*) AS n FROM imoveis').get().n;
        console.log(`💾 Total na tabela imoveis: ${total}`);
    }

    if (log.sucesso.length) {
        console.log('\nImóveis importados:');
        log.sucesso.forEach(s => console.log(`  • ${s.titulo} — R$ ${s.preco || '?'} (${s.fotos} fotos)`));
    }
    if (log.pulados.length) {
        console.log('\nPulados:');
        log.pulados.forEach(p => console.log(`  • ${p.url} — ${p.motivo}`));
    }

    if (!dry) {
        registrarLog({
            agente: 'sistema', nivel: 'sucesso',
            mensagem: `Migração concluída: ${log.sucesso.length} imóveis importados`,
            contexto: { sucesso: log.sucesso.length, pulados: log.pulados.length, fotosErr: log.fotosErr.length }
        });
    }
}

async function migrarTudo({ skipExistentes = true } = {}) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    const urls = await coletarUrls();
    const log = { sucesso: [], pulados: [], fotosErr: [] };
    for (const url of urls) {
        try { await migrarImovel(url, log, { skipExistentes }); }
        catch (e) { log.pulados.push({ url, motivo: e.message }); }
        await new Promise(r => setTimeout(r, 400));
    }
    registrarLog({
        agente: 'sistema', nivel: 'sucesso',
        mensagem: `Re-migração noturna: ${log.sucesso.length} imóveis OK, ${log.pulados.length} pulados`,
        contexto: { sucesso: log.sucesso.length, pulados: log.pulados.length }
    });
    return log;
}

module.exports = { migrarTudo, parsePreco };

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
