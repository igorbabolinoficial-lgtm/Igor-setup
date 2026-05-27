// meta-ads.mjs — Marketing API do Meta — Click to WhatsApp
// Suporta múltiplos ad sets (públicos) + múltiplos anúncios por set (A/B).
//
// Env vars:
//   META_SYSTEM_USER_TOKEN  — system user token permanente
//   META_AD_ACCOUNT_ID      — act_XXXXXX
//   META_PAGE_ID            — ID da página Facebook do Igor
//   META_WHATSAPP_NUMBER    — número com DDI (ex: 554891493622)
//   META_PIXEL_ID           — (opcional) pixel pra retargeting

import fs   from 'fs';
import path from 'path';
import { log } from './logger.mjs';

const TOKEN      = process.env.META_SYSTEM_USER_TOKEN;
const AD_ACCOUNT = process.env.META_AD_ACCOUNT_ID;
const PAGE_ID    = process.env.META_PAGE_ID;
const WA_NUMBER  = process.env.META_WHATSAPP_NUMBER;
const PIXEL_ID   = process.env.META_PIXEL_ID;
const API_BASE   = 'https://graph.facebook.com/v25.0';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function apiPost(endpoint, body) {
  const url  = `${API_BASE}${endpoint}`;
  const form = new URLSearchParams({ access_token: TOKEN, ...body });
  const r    = await fetch(url, { method: 'POST', body: form });
  const json = await r.json();
  if (json.error) throw new Error(`Meta API [${endpoint}]: ${json.error.message} | code:${json.error.code}`);
  return json;
}

async function apiGet(endpoint, params = {}) {
  const qs   = new URLSearchParams({ access_token: TOKEN, ...params });
  const r    = await fetch(`${API_BASE}${endpoint}?${qs}`);
  const json = await r.json();
  if (json.error) throw new Error(`Meta API [${endpoint}]: ${json.error.message} | code:${json.error.code}`);
  return json;
}

async function resolverCidades(cidades, raioKm) {
  const cities = [];
  for (const c of cidades) {
    try {
      const res = await apiGet('/search', {
        type: 'adgeolocation',
        q: c.nome,
        location_types: '["city"]',
        country_code: c.pais || 'BR',
      });
      const hit = (res.data || [])[0];
      if (hit) cities.push({ key: hit.key, radius: raioKm, distance_unit: 'kilometer' });
    } catch {
      log.warn('[meta-ads] Cidade não encontrada', { cidade: c.nome });
    }
  }
  return { cities };
}

// ─── 1. Campanha ──────────────────────────────────────────────────────────────

export async function criarCampanha({ nome, status = 'PAUSED', objetivo = 'OUTCOME_ENGAGEMENT' }) {
  const res = await apiPost(`/${AD_ACCOUNT}/campaigns`, {
    name: nome,
    objective: objetivo,
    status,
    special_ad_categories: '[]',
    is_adset_budget_sharing_enabled: 'false',  // ABO: orçamento por ad set, sem compartilhamento
  });
  log.info('[meta-ads] Campanha criada', { id: res.id, nome, objetivo });
  return res.id;
}

// ─── 2. Ad Set ────────────────────────────────────────────────────────────────
//
// Perfis de segmentação pré-definidos (atalhos):
//   'local'       — SC, Garopaba/Imbituba/Florianópolis, 28-60
//   'investidor'  — SP/RJ/RS, 35-65, interesses em imóveis/investimento
//   'retargeting' — visitantes do site (requer PIXEL_ID)
//   'lookalike'   — semelhantes a quem já converteu
//   custom        — passa segmentacao: { cidades, raioKm, idadeMin, idadeMax, genero, interesses }

const PERFIS = {
  local: {
    cidades:  [{ nome: 'Garopaba' }, { nome: 'Imbituba' }, { nome: 'Florianópolis' }],
    raioKm:   40,
    idadeMin: 28,
    idadeMax: 60,
  },
  investidor: {
    cidades:  [{ nome: 'São Paulo' }, { nome: 'Rio de Janeiro' }, { nome: 'Porto Alegre' }, { nome: 'Curitiba' }],
    raioKm:   30,
    idadeMin: 35,
    idadeMax: 65,
    interesses: [6002979192120, 6003446239080], // Real Estate | Investimento imobiliário
  },
  veraneiro: {
    cidades:  [{ nome: 'São Paulo' }, { nome: 'Curitiba' }, { nome: 'Porto Alegre' }],
    raioKm:   30,
    idadeMin: 30,
    idadeMax: 60,
  },
};

export async function criarAdSet({
  campanhaId,
  nome,
  orcamentoDiarioBRL,
  perfil,        // 'local' | 'investidor' | 'veraneiro' | null (usa segmentacao custom)
  segmentacao = {},
  status = 'PAUSED',
  modo = 'wa',   // 'wa' = Click to WhatsApp (requer WABA vinculada) | 'traffic' = TRAFFIC + wa.me link
}) {
  // Mescla perfil pré-definido com overrides do caller
  const base = perfil ? { ...PERFIS[perfil], ...segmentacao } : segmentacao;
  const {
    cidades   = [{ nome: 'Garopaba' }, { nome: 'Imbituba' }],
    raioKm    = 30,
    idadeMin  = 25,
    idadeMax  = 65,
    genero    = 0,
    interesses = [],
    retargeting = false,  // true = usa pixel pra custom audience de visitantes
  } = base;

  const geoLocations = await resolverCidades(cidades, raioKm);

  const targetingObj = {
    geo_locations: geoLocations,
    age_min: idadeMin,
    age_max: idadeMax,
    ...(genero !== 0 ? { genders: [genero] } : {}),
    ...(interesses.length ? { interests: interesses.map(id => ({ id: String(id) })) } : {}),
    targeting_automation: { advantage_audience: 0 },
  };

  // Retargeting: adiciona custom audience baseada em pixel (visitantes do site)
  if (retargeting && PIXEL_ID) {
    targetingObj.custom_audiences = [{ id: PIXEL_ID }]; // referência ao pixel — precisa de audience criada
  }

  const adSetParams = {
    name: nome,
    campaign_id: campanhaId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: modo === 'traffic' ? 'LINK_CLICKS' : 'CONVERSATIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: Math.round(orcamentoDiarioBRL * 100),
    status,
    targeting: JSON.stringify(targetingObj),
  };

  // Click to WhatsApp — especifica o número exato via whatsapp_phone_number
  if (modo === 'wa') {
    adSetParams.destination_type = 'WHATSAPP';
    adSetParams.promoted_object = JSON.stringify({
      page_id: PAGE_ID,
      ...(WA_NUMBER ? { whatsapp_phone_number: WA_NUMBER } : {}),
    });
  }

  const res = await apiPost(`/${AD_ACCOUNT}/adsets`, adSetParams);
  log.info('[meta-ads] AdSet criado', { id: res.id, nome, perfil: perfil || 'custom', modo });
  return res.id;
}

// ─── 3. Duplicar Ad Set ───────────────────────────────────────────────────────
// Clona um ad set existente — útil pra testar mesmo criativo em público diferente.

export async function duplicarAdSet({ adSetId, novoNome, novaSegmentacao, status = 'PAUSED' }) {
  // Meta tem endpoint nativo de cópia
  const res = await apiPost(`/${adSetId}/copies`, {
    campaign_id: undefined,   // mantém na mesma campanha
    rename_options: JSON.stringify({ rename_suffix: ` · Cópia` }),
    status_option: 'PAUSED',
  });
  const novoId = res.copied_adset_id || (res.copies?.[0]?.id);
  if (!novoId) throw new Error('duplicarAdSet: Meta não retornou o ID copiado');

  // Renomeia se pedido
  if (novoNome) {
    await apiPost(`/${novoId}`, { name: novoNome });
  }

  // Atualiza segmentação se pedida
  if (novaSegmentacao) {
    const {
      cidades  = [{ nome: 'Garopaba' }],
      raioKm   = 30,
      idadeMin = 25,
      idadeMax = 65,
    } = novaSegmentacao;
    const geoLocations = await resolverCidades(cidades, raioKm);
    const targetingObj = {
      geo_locations: geoLocations,
      age_min: idadeMin,
      age_max: idadeMax,
      targeting_automation: { advantage_audience: 0 },
    };
    await apiPost(`/${novoId}`, { targeting: JSON.stringify(targetingObj) });
  }

  // Ativa se pedido
  if (status === 'ACTIVE') await apiPost(`/${novoId}`, { status: 'ACTIVE' });

  log.info('[meta-ads] AdSet duplicado', { original: adSetId, copia: novoId });
  return novoId;
}

// ─── 4. Upload de imagem ──────────────────────────────────────────────────────

export async function uploadImagem(imagemPath) {
  let bytes, nome;
  if (/^https?:\/\//i.test(imagemPath)) {
    const r = await fetch(imagemPath);
    if (!r.ok) throw new Error(`Falha ao baixar imagem ${imagemPath}: HTTP ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
    nome  = imagemPath.split('/').pop().split('?')[0] || 'imagem.jpg';
  } else {
    bytes = fs.readFileSync(imagemPath);
    nome  = path.basename(imagemPath);
  }
  const res  = await apiPost(`/${AD_ACCOUNT}/adimages`, { bytes: bytes.toString('base64'), name: nome });
  const hash = Object.values(res.images)[0].hash;
  log.info('[meta-ads] Imagem enviada', { hash, nome });
  return hash;
}

// ─── 5. Criativo ──────────────────────────────────────────────────────────────
// CTA: WHATSAPP_MESSAGE — abre WA com mensagem pré-preenchida.

export async function criarCriativo({ nome, imagemHash, titulo, corpo, mensagemInicial, slides, modo = 'wa' }) {
  // IMPORTANTE: mensagemInicial deve ser específica do imóvel/anúncio para que
  // a IA saiba de qual propriedade o lead está falando quando chegar no WhatsApp.
  // Ex: "Oi Igor! Vi o anúncio do terreno na Praia do Rosa e quero mais informações."
  const msgTexto = mensagemInicial || 'Olá, tenho interesse em um imóvel!';
  // Usa encodeURIComponent uma única vez — apiPost (URLSearchParams) faz o segundo encode automaticamente
  const waLink = WA_NUMBER
    ? `https://wa.me/${WA_NUMBER}?text=${msgTexto}`
    : 'https://imobiliariapraiadorosa.com.br';

  // traffic: WHATSAPP_LINK abre wa.me sem integração nativa WABA
  // wa: WHATSAPP_MESSAGE usa integração nativa (requer WABA vinculada)
  const ctaWa = modo === 'traffic'
    ? { type: 'WHATSAPP_LINK', value: { link: waLink } }
    : { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } };

  let objectStorySpec;
  if (slides && slides.length > 1) {
    objectStorySpec = {
      page_id: PAGE_ID,
      link_data: {
        message: corpo,
        link: waLink,
        child_attachments: slides.map((s) => ({
          image_hash: s.hash,
          link: waLink,
          name: s.titulo || titulo,
          description: s.descricao || '',
          call_to_action: ctaWa,
        })),
        call_to_action: ctaWa,
        multi_share_optimized: true,
        multi_share_end_card: false,
      },
    };
  } else {
    objectStorySpec = {
      page_id: PAGE_ID,
      link_data: {
        image_hash: imagemHash,
        link: waLink,
        message: corpo,
        name: titulo,
        call_to_action: ctaWa,
      },
    };
  }

  const res = await apiPost(`/${AD_ACCOUNT}/adcreatives`, {
    name: nome,
    object_story_spec: JSON.stringify(objectStorySpec),
  });
  log.info('[meta-ads] Criativo criado', { id: res.id });
  return res.id;
}

// ─── 6. Anúncio ───────────────────────────────────────────────────────────────

export async function criarAnuncio({ adSetId, nome, criativoId, status = 'PAUSED' }) {
  const res = await apiPost(`/${AD_ACCOUNT}/ads`, {
    name: nome,
    adset_id: adSetId,
    creative: JSON.stringify({ creative_id: criativoId }),
    status,
  });
  log.info('[meta-ads] Anúncio criado', { id: res.id, nome });
  return res.id;
}

// ─── 7. Duplicar Anúncio ──────────────────────────────────────────────────────
// Clona um anúncio — útil pra testar copy diferente no mesmo público.

export async function duplicarAnuncio({ anuncioId, novoAdSetId, novoNome, status = 'PAUSED' }) {
  const res = await apiPost(`/${anuncioId}/copies`, {
    ...(novoAdSetId ? { adset_id: novoAdSetId } : {}),
    rename_options: JSON.stringify({ rename_suffix: ' · Cópia' }),
    status_option: 'PAUSED',
  });
  const novoId = res.copied_ad_id || (res.copies?.[0]?.id);
  if (!novoId) throw new Error('duplicarAnuncio: Meta não retornou o ID copiado');

  if (novoNome) await apiPost(`/${novoId}`, { name: novoNome });
  if (status === 'ACTIVE') await apiPost(`/${novoId}`, { status: 'ACTIVE' });

  log.info('[meta-ads] Anúncio duplicado', { original: anuncioId, copia: novoId });
  return novoId;
}

// ─── 8. Fluxo completo — múltiplos públicos + múltiplos criativos ─────────────
//
// Estrutura do body:
// {
//   nomeCampanha: 'Igor - Terrenos Rosa Mai/2026',
//   status: 'PAUSED',
//   adSets: [
//     {
//       nome: 'Local SC',
//       perfil: 'local',            // atalho de segmentação
//       orcamentoDiarioBRL: 30,
//       anuncios: [
//         { titulo: 'Terreno com vista pro mar', corpo: '...', imagemPath: '...', mensagemInicial: '...' },
//         { titulo: 'Invista no Rosa', corpo: '...',           imagemPath: '...', mensagemInicial: '...' },
//       ]
//     },
//     {
//       nome: 'Investidor SP/RJ',
//       perfil: 'investidor',
//       orcamentoDiarioBRL: 40,
//       anuncios: [
//         { titulo: 'Renda passiva no litoral SC', corpo: '...', imagemPath: '...' },
//       ]
//     }
//   ]
// }

export async function criarCampanhaCompleta({
  nomeCampanha,
  adSets = [],
  status = 'PAUSED',
  modo = 'wa',   // 'wa' | 'traffic'
}) {
  if (!adSets.length) throw new Error('Informe ao menos um adSet');

  log.info('[meta-ads] Iniciando campanha completa', { nomeCampanha, adSets: adSets.length, modo });

  const objetivo = modo === 'traffic' ? 'OUTCOME_TRAFFIC' : 'OUTCOME_ENGAGEMENT';
  const campanhaId = await criarCampanha({ nome: nomeCampanha, status, objetivo });
  const resultado  = { campanhaId, adSets: [] };

  for (const set of adSets) {
    const adSetId = await criarAdSet({
      campanhaId,
      nome: set.nome || `${nomeCampanha} · ${set.perfil || 'Público'}`,
      orcamentoDiarioBRL: set.orcamentoDiarioBRL || 30,
      perfil: set.perfil,
      segmentacao: set.segmentacao || {},
      status,
      modo,
    });

    const anunciosCriados = [];
    for (const anuncio of (set.anuncios || [])) {
      let criativoId;
      if (anuncio.imagens && anuncio.imagens.length > 1) {
        const slides = await Promise.all(anuncio.imagens.map(async (img) => ({
          hash:      await uploadImagem(img.path),
          titulo:    img.titulo || anuncio.titulo,
          descricao: img.descricao || '',
        })));
        criativoId = await criarCriativo({
          nome: `${anuncio.titulo} · Criativo`,
          titulo: anuncio.titulo,
          corpo: anuncio.corpo,
          mensagemInicial: anuncio.mensagemInicial,
          slides,
          modo,
        });
      } else {
        const imagemHash = await uploadImagem(anuncio.imagemPath);
        criativoId = await criarCriativo({
          nome: `${anuncio.titulo} · Criativo`,
          imagemHash,
          titulo: anuncio.titulo,
          corpo: anuncio.corpo,
          mensagemInicial: anuncio.mensagemInicial,
          modo,
        });
      }

      const anuncioId = await criarAnuncio({
        adSetId,
        nome: anuncio.titulo,
        criativoId,
        status,
      });
      anunciosCriados.push({ anuncioId, criativoId, titulo: anuncio.titulo });
    }

    resultado.adSets.push({ adSetId, nome: set.nome, perfil: set.perfil, anuncios: anunciosCriados });
  }

  log.info('[meta-ads] Campanha completa criada', {
    campanhaId,
    totalAdSets: resultado.adSets.length,
    totalAnuncios: resultado.adSets.reduce((s, a) => s + a.anuncios.length, 0),
  });
  return resultado;
}

// Atalho retrocompatível — usa criarCampanhaCompleta internamente
export async function criarLeadAdCompleto({
  nomeCampanha,
  imagemPath,
  imagens,
  titulo,
  corpo,
  mensagemInicial = 'Olá, vi o anúncio e tenho interesse em um imóvel!',
  orcamentoDiarioBRL = 30,
  segmentacao = {},
  status = 'PAUSED',
}) {
  const res = await criarCampanhaCompleta({
    nomeCampanha,
    status,
    adSets: [{
      nome: `${nomeCampanha} · AdSet`,
      segmentacao,
      orcamentoDiarioBRL,
      anuncios: [{
        titulo,
        corpo,
        mensagemInicial,
        imagemPath,
        imagens,
      }],
    }],
  });
  const adSet   = res.adSets[0];
  const anuncio = adSet.anuncios[0];
  return { campanhaId: res.campanhaId, adSetId: adSet.adSetId, criativoId: anuncio.criativoId, anuncioId: anuncio.anuncioId };
}

// ─── 9. Métricas comparativas ─────────────────────────────────────────────────
// Retorna performance de todos os anúncios de uma campanha lado a lado.
// Métricas por anúncio: impressões, cliques, conversas WA iniciadas, custo.

export async function comparativoAnuncios(campanhaId, datPreset = 'last_7d') {
  // Lista todos os anúncios da campanha
  const adsRes = await apiGet(`/${campanhaId}/ads`, {
    fields: 'id,name,adset_id,status',
    limit: '100',
  });
  const ads = adsRes.data || [];

  if (!ads.length) return { campanhaId, anuncios: [] };

  // Busca métricas de todos em paralelo
  const comMetricas = await Promise.all(ads.map(async (ad) => {
    try {
      const ins = await apiGet(`/${ad.id}/insights`, {
        fields: 'impressions,clicks,spend,actions,cost_per_action_type,ctr,cpc',
        date_preset: datPreset,
      });
      const data = ins.data?.[0] || {};

      // Extrai conversas WA das actions
      const actions      = data.actions || [];
      const conversasWa  = actions.find(a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d')?.value || 0;
      const cliquesWa    = actions.find(a => a.action_type === 'click_to_whatsapp')?.value
                        || actions.find(a => a.action_type === 'whatsapp_click')?.value || 0;

      return {
        id:          ad.id,
        nome:        ad.name,
        adSetId:     ad.adset_id,
        status:      ad.status,
        impressoes:  Number(data.impressions || 0),
        cliques:     Number(data.clicks || 0),
        ctr:         parseFloat(data.ctr || 0).toFixed(2),    // %
        cpc:         parseFloat(data.cpc || 0).toFixed(2),    // R$
        gasto:       parseFloat(data.spend || 0).toFixed(2),  // R$
        conversasWa: Number(conversasWa),
        cliquesWa:   Number(cliquesWa),
        custoPorConversa: conversasWa > 0
          ? (parseFloat(data.spend || 0) / Number(conversasWa)).toFixed(2)
          : null,
      };
    } catch {
      return { id: ad.id, nome: ad.name, erro: 'sem dados no período' };
    }
  }));

  // Ordena pelo número de conversas WA (melhor primeiro)
  comMetricas.sort((a, b) => (b.conversasWa || 0) - (a.conversasWa || 0));

  return { campanhaId, periodo: datPreset, anuncios: comMetricas };
}

// ─── 10. Utilitários ──────────────────────────────────────────────────────────

export async function listarCampanhas() {
  return apiGet(`/${AD_ACCOUNT}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget,spend_cap',
    limit: '50',
  });
}

export async function listarAdSets(campanhaId) {
  return apiGet(`/${campanhaId}/adsets`, {
    fields: 'id,name,status,daily_budget,optimization_goal,targeting',
    limit: '100',
  });
}

export async function listarAnuncios(campanhaIdOuAdSetId) {
  return apiGet(`/${campanhaIdOuAdSetId}/ads`, {
    fields: 'id,name,status,adset_id,creative{id,name}',
    limit: '100',
  });
}

export async function pausarCampanha(id)  { return apiPost(`/${id}`, { status: 'PAUSED' }); }
export async function ativarCampanha(id)  { return apiPost(`/${id}`, { status: 'ACTIVE' }); }
export async function pausarAdSet(id)     { return apiPost(`/${id}`, { status: 'PAUSED' }); }
export async function ativarAdSet(id)     { return apiPost(`/${id}`, { status: 'ACTIVE' }); }
export async function pausarAnuncio(id)   { return apiPost(`/${id}`, { status: 'PAUSED' }); }
export async function ativarAnuncio(id)   { return apiPost(`/${id}`, { status: 'ACTIVE' }); }

export async function metricas(campanhaId, datPreset = 'last_7d') {
  return apiGet(`/${campanhaId}/insights`, {
    fields: 'impressions,clicks,spend,actions,ctr,cpc,cost_per_action_type',
    date_preset: datPreset,
    level: 'ad',   // detalhado por anúncio
  });
}

export function metaAdsReady() {
  return !!(TOKEN && AD_ACCOUNT && PAGE_ID);
}
