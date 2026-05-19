// Orquestrador da conversa: recebe mensagem do lead -> monta contexto -> chama Groq -> envia resposta.
import { chat } from './groq.js';
import { resumoCatalogo, linkImovel, imovelPorId, formatarImovelDestaque } from './catalogo.js';
import { getRecentMessages, findOrCreateLeadByPhone, saveMessage, touchLead, syncLeadToIgor } from './storage.js';
import { sendText, sendVoice, resolveLidToPhone, setTyping, downloadMediaFromUrl } from './waha.js';
import { transcribeAudio } from './transcribe.js';
import { gerarAudio, ttsHabilitado } from './tts.js';
import { log } from './logger.js';

const IGOR_DNA = {
  nome: process.env.IGOR_NOME || 'Igor Babolin',
  creci: process.env.IGOR_CRECI || '55601',
  whatsapp: process.env.IGOR_WHATSAPP || '4891493622',
  regiao: process.env.IGOR_REGIAO || 'Praia do Rosa, Garopaba e Imbituba (SC)',
  site: process.env.IGOR_SITE || 'https://babolin.tech',
};

async function buildSystemPrompt() {
  const catalogo = await resumoCatalogo();

  // Imovel do anuncio atual (Meta Ads). Quando setado, IA abre direto nele.
  const promotedId = process.env.BROADCAST_PROMOTED_PROPERTY_ID || '';
  let destaque = null;
  if (promotedId) {
    const p = await imovelPorId(promotedId.trim());
    destaque = formatarImovelDestaque(p);
  }

  return `Voce e o ${IGOR_DNA.nome}, corretor com 12 anos de experiencia na Praia do Rosa, Garopaba e Imbituba (SC, CRECI ${IGOR_DNA.creci}).
Voce atende clientes pelo WhatsApp. Seu papel: entender o que o cliente quer, coletar TODOS os dados de qualificacao e indicar imoveis do catalogo quando fizer sentido.

IMPORTANTE — voce e o Igor falando diretamente. Nao se apresente como assistente nem como bot. Se o cliente perguntar "voce e uma IA / robo / bot", responde uma vez: "Sou o assistente digital do Igor. Ele acompanha e entra quando precisar." Depois segue a conversa normal.

ESTILO DE ESCRITA (CRITICO — esse e o tom):
Mensagens devem soar como humano digitando rapido no WhatsApp. Curto, com conector natural antes da pergunta. NUNCA robotico, NUNCA formulario.

EXEMPLOS BONS (siga esse estilo):
"Mas esta interessado no imovel?"
"Entendi. Pra comprar ou alugar?"
"Boa. Pra voce morar entao?"
"E quantos quartos voce precisa?"
"Certo. Tem ideia de valor?"
"Entendi, e em quanto tempo voce pretende decidir?"

EXEMPLOS RUINS (NUNCA assim):
- Robotico/seco: "Comprar ou alugar?" (sem conector, soa formulario)
- Narrando: "Entendi, voce procura algo no centro para morar sem depender de carro..."
- Paragrafo: 3+ linhas explicando contexto
- 2 perguntas: "Comprar ou alugar? E quantos quartos?"

REGRAS DE ESCRITA:
- Maximo 15 palavras por mensagem.
- Comece com um conector natural curto quando fizer sentido: "Entendi.", "Boa.", "Certo.", "Ok.", "Show.", "E ...". Da fluidez sem narrar.
- NUNCA comece com "Entendi, voce procura X..." parafraseando o lead — robotico ao contrario.
- NUNCA faça 2 perguntas na mesma resposta.
- Portugues coloquial profissional. "voce" por extenso (NUNCA "vc"). "esta" (nao "ta"). "pra" e ok. Sem emoji.
- Sem floreio comercial: nada de "Otimo!", "Perfeito!", "Que legal!".

${destaque ? `IMOVEL DO ANUNCIO:
${destaque}

O lead chegou por anuncio deste imovel especifico. NAO pergunte bairro/regiao/tipo — ja sabemos.

` : `ABERTURA (primeira ou segunda mensagem, ainda sem contexto):
Se o lead so disse "oi" / "ola" / "bom dia" ou algo curto sem contexto, abra assim (escolha uma, varie):
- "Oi! Aqui e o Igor. Procura imovel pra comprar, alugar ou aluguel de temporada?"
- "Ola! Tudo bem? Procurando algo na regiao da Praia do Rosa? Comprar ou alugar?"
- "Oi! Em que regiao voce esta procurando? Praia do Rosa, Garopaba, Imbituba?"

NUNCA abra perguntando "Mas esta interessado no imovel?" — soa robotico quando o lead chegou cold.

`}PIPELINE DE QUALIFICAÇAO COMPLETA (precisa de TODOS os dados, faça UMA pergunta por turno):
1. Tipo: casa, apartamento, terreno, sitio, pousada?
2. Intencao: comprar, alugar (anual), aluguel de temporada, ou tem imovel pra vender?
3. Perfil de uso: pra morar, investir/locar, ou veraneio?
4. Regiao preferida: Praia do Rosa, Garopaba, Imbituba, Ibiraquera, ou tanto faz?
5. Quartos: quantos no minimo?
6. Faixa de preco: tem ideia de quanto pretende investir/pagar?
7. Forma de pagamento (se compra): a vista, financiamento, FGTS, troca?
8. Prazo: pra quando precisa? (urgente, alguns meses, vou pensar)
9. Nome do lead se ainda nao soubermos.

COMO OPERAR A PIPELINE (REGRA CRITICA — leia com atençao):
Antes de gerar a resposta, FAÇA esta verificaçao mental sobre TODO o historico:

  - 1 Tipo: o lead disse casa, apartamento, terreno, lote, sitio, pousada, kitnet, cobertura? CHECADO.
  - 2 Intencao: disse comprar, alugar, locar, financiar, temporada, vender, anual, mensal? CHECADO.
  - 3 Perfil de uso: disse morar, residir, familia, investir, veraneio, ferias, locar pra outros, ja moro em? CHECADO.
  - 4 Regiao: mencionou Praia do Rosa, Rosa Sul/Norte/Internacional, Garopaba, Imbituba, Ibiraquera, Ferrugem, Vigia, Campo Duna, tanto faz, qualquer? CHECADO.
  - 5 Quartos: mencionou numero de quartos, dormitorios, suite, "um", "dois", "tres"? CHECADO.
  - 6 Preco: disse valor, faixa, R$, mil, milhao, ate, entre? CHECADO.
  - 7 Pagamento (se for compra): disse a vista, financiar, FGTS, entrada, troca? CHECADO. (Pular se intencao for aluguel/temporada.)
  - 8 Prazo: disse logo, urgente, mes que vem, depois, ainda nao sei, vou pensar, sem pressa? CHECADO.
  - 9 Nome: lead se identificou ou voce ja viu o nome no historico? CHECADO.

So pergunte o PROXIMO ponto que NAO esta checado. NUNCA repita pergunta cuja resposta ja esta no historico, mesmo fora de ordem.

OBJETIVO: completar TODOS os 9 pontos antes de encerrar. NAO desista antes de coletar tudo.

QUANDO TODOS OS PONTOS ESTIVEREM CHECADOS:
Se ja tem >= 8 pontos coletados:
- Se tem imovel no catalogo que combina, mostre: "Olha, baseado no que voce me passou tenho [TITULO_EXATO] em [BAIRRO] por [PRECO]. Quer ver as fotos? Link: ${IGOR_DNA.site}/imovel.html?id=ID"
- Se nao tem nada que combine perfeitamente, diga: "Anotei seu perfil, ainda nao tenho exatamente isso mas estou em contato com proprietarios da regiao. Te aviso assim que aparecer algo do seu jeito."
Depois disso, mantem a conversa aberta — responda perguntas pontuais, marque visita se pedir.

SAIDA DA PIPELINE — se o lead disser:
- "sou proprietario" / "so estou testando" / "sou concorrente" / "sou jornalista" -> "Entendi, obrigado pelo contato. Qualquer imovel que precisar na regiao, estou por aqui." E pare.
- "quero falar com humano" / "atendente" / "pessoa de verdade" -> "Claro, em instantes o Igor te chama por aqui."
- "voce e uma IA?" / "bot?" / "robo?" -> "Sou o assistente digital do Igor. Ele acompanha e entra quando precisar." NUNCA negue. Depois retoma a proxima pergunta da pipeline.
- Linguagem ofensiva -> "Prefiro nao continuar nesse tom. Se precisar de imovel na regiao, estou por aqui." E pare.

ANTI-ALUCINAÇAO:
- So fale com autoridade de imoveis listados no CATALOGO abaixo. Pra qualquer outro nome (bairro, condominio, lugar) que o lead mencionar, voce nao sabe nada — apenas acolha ("entendi, voce conhece o Villa Bela entao") e siga com a proxima pergunta da pipeline. NUNCA descreva nada que nao esteja no catalogo.
- Se o lead manda algo confuso (uma palavra solta, nome proprio, "ok"), pergunte de volta: "Desculpa, nao entendi — pode me explicar?".
- Nunca invente preço, area, caracteristicas, distancias.

USO DO CATALOGO:
- Link de imovel: ${IGOR_DNA.site}/imovel.html?id=ID (substitua ID pelo valor real do campo id). JAMAIS escreva placeholder <id> ou {id}.
- Use o titulo EXATO do imovel como esta no catalogo.
- Site geral: ${IGOR_DNA.site} (catalogo completo, sobre, contato).

CATALOGO ATUAL:
${catalogo}`;
}

// Etapa 1: chamada do webhook assim que chega inbound.
// Resolve LID, transcreve audio (se houver), cria/atualiza lead, persiste no banco.
// Devolve o incoming enriquecido (com phone real + leadId) pra entrar no coalescer.
export async function persistIncoming(incoming) {
  let { phone, pushName, body, wahaMessageId, mediaType, mediaUrl, mediaMimetype } = incoming;
  // Compat: o parser do WAHA pode chamar de evolutionMessageId
  wahaMessageId = wahaMessageId || incoming.evolutionMessageId;
  const { fromIsLid } = incoming;

  if (fromIsLid) {
    const realPhone = await resolveLidToPhone(phone);
    if (realPhone) {
      log.info('LID resolvido', { lid: phone, phone: realPhone });
      phone = realPhone;
    } else {
      log.warn('Nao foi possivel resolver LID, usando LID como phone', { lid: phone });
    }
  }

  // Se for audio (PTT do WhatsApp = ogg/opus), tenta transcrever pra Groq Whisper
  // antes de salvar. Se rolar, body persistido vira o texto — historico, coalescer
  // e LLM passam a ver a fala como texto normal.
  const looksAudio = mediaType && /^audio\//i.test(mediaType);
  let transcribed = false;
  if (looksAudio && mediaUrl) {
    try {
      const media = await downloadMediaFromUrl(mediaUrl, mediaMimetype);
      if (media?.buffer) {
        const texto = await transcribeAudio(media.buffer, media.mimetype);
        if (texto) {
          body = texto;
          transcribed = true;
          log.info('Audio transcrito', { phone, chars: texto.length, preview: texto.slice(0, 80) });
        }
      }
    } catch (err) {
      log.warn('Falha transcrevendo audio', { phone, err: err.message });
      body = body || '[audio - falha na transcricao]';
    }
  } else if (looksAudio && !mediaUrl) {
    log.warn('Audio recebido sem mediaUrl no payload — verificar config STORE_MEDIA do WAHA', { phone });
  }

  log.info('Inbound recebido', { phone, pushName, mediaType, transcribed, body: body?.slice(0, 80) });

  const lead = await findOrCreateLeadByPhone(phone, { name: pushName || phone });
  await saveMessage({
    phone,
    direction: 'in',
    body,
    leadId: lead.id,
    wahaMessageId,
    meta: { pushName, mediaType, transcribed },
  });
  // Toca last_whatsapp_at sem mexer no status — status valido so vira 'respondido'
  // apos processBatch enviar resposta. (CHECK constraint: pendente|enviado|respondido|opt_out)
  await touchLead(lead.id);

  return { ...incoming, phone, leadId: lead.id };
}

// Etapa 2: chamada pelo coalescer apos o debounce expirar.
// Recebe 1+ inbounds agrupados, monta resposta unica considerando o batch.
export async function processBatch(batch) {
  if (!batch || batch.length === 0) return null;

  const last = batch[batch.length - 1];
  const { phone, leadId } = last;
  // Se algum inbound do batch foi audio (transcrito), respondemos tambem em audio
  const inboundFoiAudio = batch.some((m) => m?.transcribed || /^audio\//i.test(m?.mediaType || ''));

  // Concatena bodies do batch em ordem cronologica pra raciocinar como "tudo que o lead disse agora".
  const combinedBody = batch
    .map((m) => (m.body || '').trim())
    .filter(Boolean)
    .join('\n');
  const inboundLen = combinedBody.length;

  log.info('Processando batch', { phone, msgs: batch.length, combinedLen: inboundLen });

  // Curto-circuito: pedido de humano. Status fica 'respondido' (schema atual nao tem
  // 'escalado'); a flag escalate_to_human ja vai na meta da message via opts.escalate.
  if (/humano|atendente|pessoa de verdade/i.test(combinedBody)) {
    return enviarResposta(phone, 'Claro, em instantes o Igor te chama por aqui.', leadId, {
      agent: true, escalate: true, inboundLen,
    });
  }

  // Historico ja contem as inbounds que persistIncoming salvou.
  const recent = await getRecentMessages(phone, 16);
  const historyForLLM = recent.map((m) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body,
  }));

  const system = await buildSystemPrompt();
  const messages = [{ role: 'system', content: system }, ...historyForLLM];

  let resposta;
  try {
    resposta = await chat(messages, { temperature: 0.65, maxTokens: 300 });
  } catch (err) {
    log.error('Falha no Groq', { err: err.message });
    resposta = 'Anotei seu contato! O Igor te responde aqui em instantes.';
  }

  if (!resposta || resposta.length < 5) {
    resposta = 'Anotei sua mensagem. O Igor te chama aqui em instantes.';
  }

  await touchLead(leadId, { whatsapp_status: 'respondido' });
  return enviarResposta(phone, resposta, leadId, { agent: true, inboundLen, comoAudio: inboundFoiAudio });
}

function splitInChunks(body) {
  // SO quebra se a IA usou linha em branco real entre paragrafos.
  // Tambem descarta chunks que sao so literal "\n", "\\n\\n" ou whitespace (a Groq
  // ja gerou "\\n\\n" como texto literal — virava bolha vazia/lixo).
  const chunks = body
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter((c) => c && !/^(?:\\?n)+$/i.test(c) && /\S/.test(c.replace(/\\n/g, '')));
  return chunks.length ? chunks : [body];
}

// Detecta se um "phone" no banco e na verdade um LID nao-resolvido.
// LID do WhatsApp tem 14+ digitos. Phone BR valido tem 12 ou 13.
function pareceLid(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 14;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitter(base, spread) { return base + Math.random() * spread; }

// Tempo de "leitura" antes do Igor começar a digitar. Curto pra resposta
// soar dentro de ~5-6s do inbound chegar.
function tempoLeitura(inboundLen = 0) {
  return Math.min(2500, 800 + Math.max(0, inboundLen) * 25);
}

// Tempo "digitando" — proporcional ao tamanho, teto em 3.5s.
// Mensagens curtas (10-12 palavras = ~60 chars) ficam em ~2s.
function tempoDigitacao(chunkLen) {
  return Math.min(3500, 600 + chunkLen * 50);
}

async function enviarResposta(phone, body, leadId, opts = {}) {
  // LID nao-resolvido agora roteia via phoneToChatId('<lid>@lid') no waha.js,
  // entao nao bloqueamos mais. Apenas registramos no log pra rastreio.
  if (pareceLid(phone)) {
    log.info('Enviando via LID (phone nao resolvido)', { phone, leadId });
  }

  const chunks = splitInChunks(body);
  const results = [];

  // Tempo de "leitura" antes da primeira bolha (deixa o lead ver "online" -> "digitando").
  if (!opts.skipReadDelay) {
    await sleep(tempoLeitura(opts.inboundLen || 0));
  }

  // Se cliente mandou audio e TTS habilitado, manda 1 audio unico com a resposta toda
  // (em vez de quebrar em chunks de texto). Mais natural quando lead esta no audio.
  if (opts.comoAudio && ttsHabilitado()) {
    try {
      const textoCompleto = chunks.join(' ');
      const { buffer, mime } = await gerarAudio(textoCompleto);
      await setTyping(phone, true);
      await sleep(tempoDigitacao(textoCompleto.length));
      await setTyping(phone, false);
      const sent = await sendVoice(phone, buffer, mime);
      await saveMessage({
        phone, direction: 'out', body: textoCompleto, leadId,
        wahaMessageId: sent?.key?.id, agentResponse: !!opts.agent,
        meta: { ...(opts.escalate ? { escalate_to_human: true } : {}), audio: true, bytes: buffer.length },
      });
      log.info('Resposta enviada em audio', { phone, bytes: buffer.length, chars: textoCompleto.length });
      return { sent: true, audio: true };
    } catch (err) {
      log.warn('Falha TTS, caindo pra texto', { phone, err: err.message });
      // continua fluxo de texto abaixo
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const typingMs = tempoDigitacao(chunk.length);
      await setTyping(phone, true);
      await sleep(typingMs);
      await setTyping(phone, false);

      const sent = await sendText(phone, chunk);
      await saveMessage({
        phone,
        direction: 'out',
        body: chunk,
        leadId,
        wahaMessageId: sent?.key?.id,
        agentResponse: !!opts.agent,
        meta: opts.escalate ? { escalate_to_human: true } : {},
      });
      log.info('Resposta enviada', { phone, chunk: i + 1, of: chunks.length, len: chunk.length, typingMs });
      results.push({ sent: true, body: chunk });

      // Pausa entre bolhas — humano releia o que mandou + decide proxima. 1.4-2.6s.
      if (i < chunks.length - 1) await sleep(jitter(1400, 1200));
    } catch (err) {
      log.error('Falha ao enviar chunk', { phone, chunk: i + 1, err: err.message });
      results.push({ sent: false, error: err.message });
    }
  }
  return results.length === 1 ? results[0] : { sent: true, chunks: results };
}

// Versao usada pelo broadcast / disparo manual.
// Pula o delay de "leitura" porque nao ha inbound — vai direto pro typing.
export async function enviarManual(phone, body, leadId) {
  return enviarResposta(phone, body, leadId, { agent: false, skipReadDelay: true });
}

export { linkImovel };
