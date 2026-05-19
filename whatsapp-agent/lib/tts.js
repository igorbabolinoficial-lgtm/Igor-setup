// Text-to-Speech via ElevenLabs. Usado quando lead manda audio: respondemos audio também.
// Cache em disco pra não pagar 2x pelo mesmo texto (igual padrao do agentes/voz.js do Igor).
// Converte MP3 -> OGG/Opus via ffmpeg (WhatsApp PTT exige OGG).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'SmoiEq4ZbybjsQdqveXv';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

const CACHE_DIR = process.env.VOZ_CACHE_DIR || path.join(path.dirname(process.env.DB_PATH || './'), 'voz-cache');

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function ttsHabilitado() {
  return !!API_KEY;
}

// Gera audio MP3 a partir de texto. Retorna { buffer, mime, cached }.
export async function gerarAudio(texto) {
  if (!API_KEY) {
    throw new Error('ELEVENLABS_API_KEY nao configurado');
  }
  ensureCacheDir();
  const hash = sha256(`${VOICE_ID}|${MODEL}|${texto}`);
  const cachePath = path.join(CACHE_DIR, `${hash}.ogg`);
  if (fs.existsSync(cachePath)) {
    const buf = fs.readFileSync(cachePath);
    log.debug('TTS cache hit', { chars: texto.length, hash: hash.slice(0, 8) });
    return { buffer: buf, mime: 'audio/ogg; codecs=opus', cached: true };
  }

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: texto,
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!r.ok) {
    const errTxt = await r.text().catch(() => '');
    throw new Error(`ElevenLabs HTTP ${r.status}: ${errTxt.slice(0, 200)}`);
  }
  const arrayBuf = await r.arrayBuffer();
  const mp3 = Buffer.from(arrayBuf);

  // Converte MP3 -> OGG/Opus pra WhatsApp PTT aceitar
  const ogg = await mp3ParaOggOpus(mp3);
  fs.writeFileSync(cachePath, ogg);
  log.info('TTS gerado', { chars: texto.length, mp3Bytes: mp3.length, oggBytes: ogg.length, hash: hash.slice(0, 8) });
  return { buffer: ogg, mime: 'audio/ogg; codecs=opus', cached: false };
}

function mp3ParaOggOpus(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-vbr', 'on',
      '-application', 'voip',
      '-ar', '48000',
      '-ac', '1',
      '-f', 'ogg',
      'pipe:1',
    ]);
    const chunks = [];
    let stderr = '';
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => (stderr += d.toString()));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 300)}`));
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.write(mp3Buffer);
    ff.stdin.end();
  });
}
