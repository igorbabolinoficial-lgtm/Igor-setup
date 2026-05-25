// Catalogo via API publica do igor-neural-system (https://babolin.tech/api/imoveis).
// Cache em memoria de 60s pra nao martelar a API.

const API_BASE = process.env.IGOR_API_BASE || 'https://babolin.tech';
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
export async function resumoCatalogo() {
  const imoveis = await fetchTodos();
  if (!imoveis.length) return 'Catalogo vazio.';
  const linhas = imoveis.map((p) => {
    const preco = fmtBRL(p.preco);
    const area = p.area_m2 ? `${p.area_m2}m²` : '';
    const bairro = p.bairro || '';
    const tipo = p.tipo ? `[${p.tipo}]` : '';
    const quartos = p.quartos ? ` · ${p.quartos}q` : '';
    return `- id=${p.id} · ${tipo} ${p.titulo} — ${preco}${area ? ` · ${area}` : ''}${quartos}${bairro ? ` · ${bairro}` : ''}`;
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

// Busca por faixa de preço (±15% do valor informado)
export async function buscarPorPreco(preco, margemPct = 0.15) {
  const min = Math.floor(preco * (1 - margemPct));
  const max = Math.ceil(preco * (1 + margemPct));
  const r = await fetch(`${API_BASE}/api/imoveis?preco_min=${min}&preco_max=${max}&ordenar=preco_asc`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.imoveis || []).slice(0, 5);
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
    return `id=${p.id} · ${p.titulo} — ${preco}${area}${quartos}${bairro}\nLink: ${linkImovel(p.id)}`;
  }).join('\n\n');
}

export function linkImovel(id) {
  return `${API_BASE}/imovel.html?id=${id}`;
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
  return `id=${p.id} · ${p.titulo} ${tipo} ${preco}${area ? ` · ${area}` : ''}${bairro ? ` · ${bairro}` : ''}\nLink: ${linkImovel(p.id)}`;
}
