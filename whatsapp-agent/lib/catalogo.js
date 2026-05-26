// Catalogo via API do igor-neural-system.
// Cache em memoria de 60s pra nao martelar a API.

// URL interna — usada APENAS para chamadas de API (fetch /api/imoveis).
// Pode ser babolin.tech ou qualquer URL interna do igor-neural-system.
const API_BASE = process.env.IGOR_API_BASE || 'https://imobiliariapraiadorosa.com.br';

// URL pública — usada para montar links que VÃO para os leads no WhatsApp.
// Sempre o site público do Igor, nunca o sistema interno.
const PUBLIC_BASE = 'https://imobiliariapraiadorosa.com.br';

const CACHE_TTL_MS = 60_000;

let _cache = { ts: 0, data: null };

const fmtBRL = (n) => {
  if (n == null) return 'Sob consulta';
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });
};

async function fetchTodos() {
  const now = Date.now();
  if (_cache.data && now - _cache.ts < CACHE_TTL_MS) return _cache.data;
  const r = await fetch(`${API_BASE}/api/imoveis`);
  if (!r.ok) throw new Error(`Falha ao buscar catalogo: HTTP ${r.status}`);
  const j = await r.json();
  _cache = { ts: now, data: j.imoveis || [] };
  return _cache.data;
}

export async function listarTodos() {
  return await fetchTodos();
}

// Resume catalogo pro system prompt. Inclui id pro LLM referenciar link correto.
// precoMax: quando informado, marca imóveis acima desse valor como [ACIMA DO ORÇAMENTO]
// — NÃO filtra (para evitar que o LLM diga "não temos X" quando existe acima do budget).
export async function resumoCatalogo(precoMax = null) {
  const imoveis = await fetchTodos();
  if (!imoveis.length) return 'Catalogo vazio.';
  const linhas = imoveis.map((p) => {
    const preco = fmtBRL(p.preco);
    const area = p.area_m2 ? `${p.area_m2}m²` : '';
    const bairro = p.bairro || '';
    const tipo = p.tipo ? `[${p.tipo}]` : '';
    const quartos = p.quartos ? ` · ${p.quartos}q` : '';
    const link = linkImovel(p);
    const acima = (precoMax && precoMax > 0 && p.preco && p.preco > precoMax)
      ? ' [ACIMA DO ORCAMENTO — mencionar so se lead pedir]'
      : '';
    return `- id=${p.id} · ${tipo} ${p.titulo} — ${preco}${area ? ` · ${area}` : ''}${quartos}${bairro ? ` · ${bairro}` : ''}${acima} → ${link}`;
  });
  return linhas.join('\n');
}

export async function buscar(query) {
  if (!query || query.length < 3) return [];
  const r = await fetch(`${API_BASE}/api/imoveis?q=${encodeURIComponent(query)}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.imoveis || []).slice(0, 5);
}

// Busca por faixa de preço.
// preco = teto do lead (budget máximo). Busca TODOS dentro do budget + 10% de margem acima.
// Retorna até 5 opções ordenadas do mais próximo ao teto (melhor custo-benefício primeiro).
export async function buscarPorPreco(preco, margemAcimaPermitida = 0.10) {
  const max = Math.ceil(preco * (1 + margemAcimaPermitida));
  const r = await fetch(`${API_BASE}/api/imoveis?preco_max=${max}&ordenar=preco_desc`);
  if (!r.ok) return [];
  const j = await r.json();
  const imoveis = j.imoveis || [];
  // Ordena pelo mais próximo ao teto (mais caro dentro do budget primeiro = melhor match)
  imoveis.sort((a, b) => (b.preco || 0) - (a.preco || 0));
  return imoveis.slice(0, 5);
}

// Busca por nome/título exato ou parcial
export async function buscarPorNome(nome) {
  if (!nome || nome.length < 3) return [];
  const r = await fetch(`${API_BASE}/api/imoveis?q=${encodeURIComponent(nome)}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.imoveis || []).slice(0, 5);
}

// Formata resultado de busca pro bot usar na resposta
export function formatarResultadoBusca(imoveis) {
  if (!imoveis.length) return null;
  return imoveis.map((p) => {
    const preco = fmtBRL(p.preco);
    const area = p.area_m2 ? ` · ${p.area_m2}m²` : '';
    const quartos = p.quartos ? ` · ${p.quartos} quartos` : '';
    const bairro = p.bairro ? ` · ${p.bairro}` : '';
    return `id=${p.id} · ${p.titulo} — ${preco}${area}${quartos}${bairro}\nLink: ${linkImovel(p)}`;
  }).join('\n\n');
}

// Link do imovel — prioriza url_origem (imobiliariapraiadorosa.com.br, site público do Igor)
// Remove prefixo "sistema." se presente no url_origem (BD interno usa sistema., site público não)
function normalizarLink(url) {
  if (!url) return url;
  return url.replace('https://sistema.imobiliariapraiadorosa.com.br', 'https://imobiliariapraiadorosa.com.br')
            .replace('http://sistema.imobiliariapraiadorosa.com.br', 'https://imobiliariapraiadorosa.com.br');
}

export function linkImovel(idOuImovel) {
  if (typeof idOuImovel === 'object' && idOuImovel) {
    if (idOuImovel.url_origem) return normalizarLink(idOuImovel.url_origem);
    return `${PUBLIC_BASE}/imovel.html?id=${idOuImovel.id}`;
  }
  return `${PUBLIC_BASE}/imovel.html?id=${idOuImovel}`;
}

export async function imovelPorId(id) {
  if (!id) return null;
  try {
    const r = await fetch(`${API_BASE}/api/imoveis/${id}`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export function formatarImovelDestaque(p) {
  if (!p) return null;
  const preco = fmtBRL(p.preco);
  const area = p.area_m2 ? `${p.area_m2}m²` : '';
  const bairro = p.bairro || '';
  const tipo = p.tipo ? `[${p.tipo}]` : '';
  return `id=${p.id} · ${p.titulo} ${tipo} ${preco}${area ? ` · ${area}` : ''}${bairro ? ` · ${bairro}` : ''}\nLink: ${linkImovel(p)}`;
}
