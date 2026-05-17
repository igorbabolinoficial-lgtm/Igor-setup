// Diagnóstico profundo: pra cada URL do sitemap, mostra o que o parser extrai.
const cheerio = require('cheerio');

const SITEMAP = 'http://imobiliariapraiadorosa.com.br/sitemap.xml';

async function buscar(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'IgorDebug' }, redirect: 'follow' });
    return { html: await r.text(), status: r.status };
}

function parse(html) {
    const $ = cheerio.load(html);
    const slider = $('.property_slider').first();
    return {
        titulo: slider.attr('data-title'),
        slug: slider.attr('data-url'),
        idHash: slider.attr('data-id'),
        temSlider: slider.length > 0,
        precoBruto: $('.price-block-btn').first().text().trim(),
    };
}

(async () => {
    const xml = await (await fetch(SITEMAP)).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map(m => m[1].trim())
        .filter(u => /\/property\/.+~\d+/.test(u));

    const okList = [];
    const problemList = [];
    const slugDupes = {};

    for (const u of urls) {
        try {
            const { html, status } = await buscar(u);
            if (status !== 200) { problemList.push({u, motivo: `HTTP ${status}`}); continue; }
            const p = parse(html);
            if (!p.temSlider) { problemList.push({u, motivo: 'sem property_slider', dump: html.slice(0, 200)}); continue; }
            if (!p.titulo || !p.slug || !p.idHash) {
                problemList.push({u, motivo: 'campo vazio', t: p.titulo, s: p.slug, i: p.idHash});
                continue;
            }
            okList.push({u, id: p.idHash, slug: p.slug, titulo: p.titulo, preco: p.precoBruto});
            slugDupes[p.slug] = (slugDupes[p.slug] || 0) + 1;
        } catch (e) { problemList.push({u, motivo: e.message}); }
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n=== RESUMO ===`);
    console.log(`Parseáveis OK: ${okList.length}`);
    console.log(`Com problema:  ${problemList.length}`);
    console.log(`Total testado: ${urls.length}`);

    // Slugs duplicados
    const dupes = Object.entries(slugDupes).filter(([, n]) => n > 1);
    if (dupes.length) {
        console.log(`\nSlugs DUPLICADOS (causa UNIQUE constraint fail): ${dupes.length}`);
        dupes.forEach(([s, n]) => console.log(` - ${s} (${n}x)`));
    }

    // IDs duplicados
    const idsCount = {};
    okList.forEach(o => idsCount[o.id] = (idsCount[o.id] || 0) + 1);
    const idDupes = Object.entries(idsCount).filter(([, n]) => n > 1);
    if (idDupes.length) {
        console.log(`\nIDs DUPLICADOS: ${idDupes.length}`);
        idDupes.forEach(([i, n]) => console.log(` - ${i} (${n}x)`));
    }

    if (problemList.length) {
        console.log('\nProblemáticos:');
        problemList.forEach(p => console.log(' -', p));
    }
})();
