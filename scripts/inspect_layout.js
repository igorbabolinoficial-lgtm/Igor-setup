const cheerio = require('cheerio');

(async () => {
    const url = 'http://imobiliariapraiadorosa.com.br/property/casa-exclusiva-caminho-do-rei~105';
    const r = await fetch(url, { headers: { 'User-Agent': 'IgorInspect' }, redirect: 'follow' });
    const html = await r.text();
    const $ = cheerio.load(html);

    console.log('=== TÍTULOS ===');
    console.log('<title>:', $('title').text());
    console.log('<h1>:', $('h1').first().text().trim());
    console.log('<h2>:', $('h2').first().text().trim());

    console.log('\n=== CLASSES PRINCIPAIS (suspeitas) ===');
    ['property_slider', 'property-detail', 'property_main', 'property-content', 'property-info',
     'price', 'preco', 'price-block', 'property-price',
     'property-gallery', 'gallery', 'slider',
     'property-description', 'description', 'desc'].forEach(c => {
        const el = $(`.${c}`);
        if (el.length) console.log(` .${c}: ${el.length} elementos`);
     });

    console.log('\n=== DATA ATTRS NA RAIZ ===');
    $('[data-id], [data-title], [data-url]').slice(0, 5).each((_, el) => {
        console.log(' tag:', el.name, $(el).attr('class'), 'data-id=', $(el).attr('data-id'), 'data-title=', $(el).attr('data-title'));
    });

    console.log('\n=== IMGs em /uploads/ ===');
    let count = 0;
    $('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && src.includes('/uploads/')) count++;
    });
    console.log('Total:', count);
})();
