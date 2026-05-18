// Smoke test do cerebro: chama Groq com o system prompt completo e uma msg de exemplo.
// Roda: npm run test-groq

import dotenv from 'dotenv';
import { chat } from '../lib/groq.js';
import { resumoCatalogo } from '../lib/catalogo.js';

dotenv.config();

const catalogo = await resumoCatalogo();
console.log('=== Catalogo carregado ===');
console.log(catalogo);
console.log('==========================\n');

const system = `Voce e Charles R. Nobre, corretor em Imbituba/SC.
Tom: direto, acolhedor.
CATALOGO:
${catalogo}`;

const userMsg = 'Oi! Vi um imóvel de vocês na praia da vila. Tem mais opções de aluguel por ali?';

console.log('USER:', userMsg);
console.log('\nCharles diz:\n');

const resposta = await chat([
  { role: 'system', content: system },
  { role: 'user', content: userMsg },
]);

console.log(resposta);
console.log('\n--- fim ---');
