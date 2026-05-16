import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Floor from './Floor.jsx';
import Desk from './Desk.jsx';
import Chair from './Chair.jsx';
import Printer from './Printer.jsx';
import CoffeeMachine from './CoffeeMachine.jsx';
import VoxelAgent from './VoxelAgent.jsx';
import Walls from './Walls.jsx';
import AreaCafe from './AreaCafe.jsx';
import Mobilia from './Mobilia.jsx';

const API_BASE = `${import.meta.env.VITE_API_BASE_URL || ''}/api`;

const FLOOR_SIZE = 22;  // ligeiramente maior pra caber 12 agentes
const SEAT_OFFSET = 0.95;

const COFFEE_SPOT = [-8.5, -6];
const PRINTER_SPOT = [8.5, -7];

// 12 agentes do Igor (Maestro + 11) — chaves batem com a coluna `agentes.chave` do SQLite
// Layout: Maestro fundo central, 3 fileiras de 4 mesas distribuídas em -8/-3/3/8 no X.
const EQUIPE = [
  // Maestro (centro fundo)
  { nome: 'maestro',           label: 'Igor (Maestro)',  deskPos: [0,   0, -9], shirtColor: '#7c5cff', phaseOffset: 0.2, walkRoute: [[0,  -9 + SEAT_OFFSET], [0, -2]],            walkSpeed: 1.4, descricao: 'Orquestra o sistema, decide o que fazer e dispara tarefas pros agentes' },

  // Fileira 1 — consultores comerciais (z = -4)
  { nome: 'sdr',               label: 'SDR',              deskPos: [-8,  0, -4], shirtColor: '#22c55e', phaseOffset: 3.3, walkRoute: [[-8, -4 + SEAT_OFFSET], [0, -2]],             walkSpeed: 1.5, descricao: 'Qualifica leads frios, gera tags + segmento + próxima ação' },
  { nome: 'closer',            label: 'Closer',           deskPos: [-3,  0, -4], shirtColor: '#84cc16', phaseOffset: 1.0, walkRoute: [[-3, -4 + SEAT_OFFSET], [0, -2]],             walkSpeed: 1.4, descricao: 'Fecha leads quentes: proposta, agenda visita, negociação' },
  { nome: 'account_manager',   label: 'Account Mgr',      deskPos: [3,   0, -4], shirtColor: '#10b981', phaseOffset: 2.5, walkRoute: [[3,  -4 + SEAT_OFFSET], COFFEE_SPOT],        walkSpeed: 1.3, descricao: 'Pós-venda: lembretes contrato, NPS, up-sell' },
  { nome: 'financeiro',        label: 'Financeiro',       deskPos: [8,   0, -4], shirtColor: '#f59e0b', phaseOffset: 4.7, walkRoute: [[8,  -4 + SEAT_OFFSET], PRINTER_SPOT],       walkSpeed: 1.3, descricao: 'Categoriza transações e monta relatórios' },

  // Fileira 2 — marketing estratégia e produção (z = 0)
  { nome: 'estrategista',      label: 'Estrategista',     deskPos: [-8,  0,  0], shirtColor: '#fbbf24', phaseOffset: 0.7, walkRoute: [[-8,  0 + SEAT_OFFSET], [-3, 0 + SEAT_OFFSET]], walkSpeed: 1.2, descricao: 'Calendário editorial + briefing por campanha' },
  { nome: 'copywriter',        label: 'Copywriter',       deskPos: [-3,  0,  0], shirtColor: '#ec4899', phaseOffset: 5.5, walkRoute: [[-3,  0 + SEAT_OFFSET], [-8, 0 + SEAT_OFFSET]], walkSpeed: 1.5, descricao: 'Escreve posts, headlines, captions' },
  { nome: 'designer',          label: 'Designer',         deskPos: [3,   0,  0], shirtColor: '#f43f5e', phaseOffset: 4.1, walkRoute: [[3,   0 + SEAT_OFFSET], PRINTER_SPOT],       walkSpeed: 1.7, descricao: 'Gera artes voxel e criativos' },
  { nome: 'midia_paga',        label: 'Mídia Paga',       deskPos: [8,   0,  0], shirtColor: '#eab308', phaseOffset: 6.9, walkRoute: [[8,   0 + SEAT_OFFSET], PRINTER_SPOT],       walkSpeed: 1.8, descricao: 'Meta Ads + Google Ads + relatórios de performance' },

  // Fileira 3 — atendimento e suporte (z = 4)
  { nome: 'community_manager', label: 'Community Mgr',    deskPos: [-8,  0,  4], shirtColor: '#fda4af', phaseOffset: 8.3, walkRoute: [[-8,  4 + SEAT_OFFSET], COFFEE_SPOT],        walkSpeed: 1.7, descricao: 'DMs + comentários, escalona humano quando preciso' },
  { nome: 'social',            label: 'Social',           deskPos: [-3,  0,  4], shirtColor: '#06b6d4', phaseOffset: 1.4, walkRoute: [[-3,  4 + SEAT_OFFSET], COFFEE_SPOT],        walkSpeed: 1.5, descricao: 'Agenda posts, supervisiona pipeline social' },
  { nome: 'pesquisa',          label: 'Pesquisa',         deskPos: [3,   0,  4], shirtColor: '#6366f1', phaseOffset: 7.1, walkRoute: [[3,   4 + SEAT_OFFSET], [-8, -4 + SEAT_OFFSET]], walkSpeed: 1.3, descricao: 'Monitora preços e concorrência na Praia do Rosa' },
  { nome: 'atendimento',       label: 'Atendimento',      deskPos: [8,   0,  4], shirtColor: '#14b8a6', phaseOffset: 4.4, walkRoute: [[8,   4 + SEAT_OFFSET], COFFEE_SPOT],        walkSpeed: 1.2, descricao: 'Suporte pós-venda: vistoria, documentação' },
];

const MODOS = [
  { id: 'live',    label: 'Live',           desc: 'Espelha /api/agentes/status em tempo real' },
  { id: 'typing',  label: 'Testar Typing',  desc: 'Todos digitando' },
  { id: 'walking', label: 'Testar Walking', desc: 'Todos em movimento' },
  { id: 'paused',  label: 'Pausa',          desc: 'Congela animações' },
];

const BREAK_CHANCE = 0.18;
const BREAK_TICK_MS = 8000;
const BREAK_DURATION_MS = 22000;

function mapStatus(apiStatus) {
  if (apiStatus === 'rodando') return 'typing';
  return 'idle';
}

function formatTempo(seg) {
  if (seg === null || seg === undefined) return 'nunca';
  if (seg < 60) return `${seg}s atrás`;
  if (seg < 3600) return `${Math.floor(seg / 60)}min atrás`;
  if (seg < 86400) return `${Math.floor(seg / 3600)}h atrás`;
  return `${Math.floor(seg / 86400)}d atrás`;
}

function statusBadgeColor(s) {
  if (s === 'rodando') return '#22c55e';
  if (s === 'recente') return '#84cc16';
  if (s === 'aguardando') return '#3b82f6';
  if (s === 'pronto') return '#a78bfa';
  if (s === 'degradado') return '#ef4444';
  return '#64748b';
}

export default function OfficeArena() {
  const [agenteData, setAgenteData] = useState({});
  const [modo, setModo] = useState('live');
  const [behavior, setBehavior] = useState({});
  const breakStartRef = useRef({});
  const [agenteSelecionado, setAgenteSelecionado] = useState(null);

  useEffect(() => {
    if (modo !== 'live') return;
    let cancelled = false;
    const carregar = async () => {
      try {
        const r = await fetch(`${API_BASE}/agentes/status`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const lista = Array.isArray(data) ? data : (data.agentes || []);
        const map = {};
        for (const a of lista) map[a.nome] = a;
        setAgenteData(map);
      } catch {}
    };
    carregar();
    const id = setInterval(carregar, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [modo]);

  useEffect(() => {
    if (modo !== 'live') {
      setBehavior({});
      breakStartRef.current = {};
      return;
    }
    const tick = setInterval(() => {
      const agora = Date.now();
      setBehavior(prev => {
        const next = { ...prev };
        for (const ag of EQUIPE) {
          const n = ag.nome;
          const apiSt = agenteData[n]?.status;
          if (prev[n] === 'breaking') {
            const inicio = breakStartRef.current[n] || agora;
            if (apiSt === 'rodando' || agora - inicio > BREAK_DURATION_MS) {
              delete next[n];
            }
          } else {
            if (apiSt !== 'rodando' && Math.random() < BREAK_CHANCE) {
              next[n] = 'breaking';
              breakStartRef.current[n] = agora;
            }
          }
        }
        return next;
      });
    }, BREAK_TICK_MS);
    return () => clearInterval(tick);
  }, [modo, agenteData]);

  const statusDoAgente = (nome) => {
    if (modo === 'typing') return 'typing';
    if (modo === 'walking') return 'walking';
    if (behavior[nome] === 'breaking') return 'walking';
    return mapStatus(agenteData[nome]?.status);
  };
  const seatedDoAgente = (nome) => statusDoAgente(nome) !== 'walking';
  const paused = modo === 'paused';

  const trabalhando = modo === 'live'
    ? EQUIPE.filter(a => statusDoAgente(a.nome) === 'typing').length
    : (modo === 'typing' ? EQUIPE.length : 0);
  const emPasseio = modo === 'live'
    ? EQUIPE.filter(a => behavior[a.nome] === 'breaking').length
    : 0;

  const agenteAberto = agenteSelecionado ? agenteData[agenteSelecionado] : null;
  const equipeAberta = agenteSelecionado ? EQUIPE.find(a => a.nome === agenteSelecionado) : null;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        minHeight: 480,
        overflow: 'hidden',
        background: '#cfd2d8',
      }}
    >
      {/* === HUD: título === */}
      <div
        style={{
          position: 'absolute', top: 12, left: 14, zIndex: 10,
          padding: '6px 12px',
          background: 'rgba(15, 15, 20, 0.72)',
          border: '1px solid #3a3f4a',
          borderRadius: 8,
          fontSize: 12, color: '#f3f4f6', letterSpacing: 0.4,
        }}
      >
        <strong style={{ color: '#fbbf24' }}>Escritório Igor Babolin · Voxel 3D</strong>
        <span style={{ opacity: 0.7, marginLeft: 8 }}>
          Maestro + 11 agentes · {trabalhando} trabalhando{emPasseio > 0 ? ` · ${emPasseio} em passeio` : ''}
        </span>
      </div>

      {/* === HUD: painel de modo === */}
      <div
        style={{
          position: 'absolute', top: 12, right: 14, zIndex: 10,
          padding: 8,
          background: 'rgba(15, 15, 20, 0.82)',
          border: '1px solid #3a3f4a',
          borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: 4, minWidth: 170,
        }}
      >
        <div style={{ fontSize: 10, color: '#fbbf24', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>
          Modo
        </div>
        {MODOS.map(m => {
          const ativo = modo === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setModo(m.id)}
              title={m.desc}
              style={{
                appearance: 'none',
                border: ativo ? '1px solid #fbbf24' : '1px solid #3a3f4a',
                background: ativo ? 'rgba(251, 191, 36, 0.18)' : 'rgba(20, 20, 28, 0.6)',
                color: ativo ? '#fef3c7' : '#cbd5e1',
                padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                textAlign: 'left', fontWeight: ativo ? 600 : 400,
              }}
            >{m.label}</button>
          );
        })}
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, lineHeight: 1.3 }}>
          {MODOS.find(m => m.id === modo)?.desc}
        </div>
      </div>

      {/* === HUD: legenda === */}
      <div
        style={{
          position: 'absolute', bottom: 12, left: 14, zIndex: 10,
          padding: '8px 12px',
          background: 'rgba(15, 15, 20, 0.78)',
          border: '1px solid #3a3f4a',
          borderRadius: 8,
          fontSize: 11, color: '#e5e7eb',
          display: 'flex', gap: 14, alignItems: 'center',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} /> Trabalhando
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#64748b' }} /> Ocioso
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#facc15' }} /> Em passeio
        </span>
      </div>

      {/* === Side panel: detalhe do agente clicado === */}
      {agenteSelecionado && (
        <div
          style={{
            position: 'absolute', top: 12, right: 200, zIndex: 11,
            width: 320, maxHeight: 'calc(100% - 24px)',
            background: 'rgba(15, 15, 20, 0.95)',
            border: '1px solid #fbbf24',
            borderRadius: 10,
            padding: 14, color: '#e5e7eb', fontSize: 12,
            overflowY: 'auto',
            boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: statusBadgeColor(agenteAberto?.status),
            }} />
            <strong style={{ fontSize: 16, color: '#fef3c7' }}>{equipeAberta?.label}</strong>
            <button
              onClick={() => setAgenteSelecionado(null)}
              style={{
                marginLeft: 'auto',
                appearance: 'none', background: 'transparent',
                border: '1px solid #3a3f4a', color: '#cbd5e1',
                width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
                fontSize: 14, lineHeight: 1,
              }}
              title="Fechar"
            >×</button>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>
            {equipeAberta?.descricao}
          </div>
          <DetalheLinha titulo="Status">
            <span style={{
              padding: '2px 8px', borderRadius: 4,
              background: statusBadgeColor(agenteAberto?.status) + '33',
              color: statusBadgeColor(agenteAberto?.status),
              textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5, fontWeight: 700,
            }}>{agenteAberto?.status || '—'}</span>
          </DetalheLinha>
          <DetalheLinha titulo="Último run">
            {formatTempo(agenteAberto?.segundos_desde_ultimo)}
          </DetalheLinha>
          <DetalheLinha titulo="Runs 24h">
            {agenteAberto?.runs_24h ?? 0}
            {agenteAberto?.erros_24h > 0 && (
              <span style={{ color: '#ef4444', marginLeft: 6 }}>· {agenteAberto.erros_24h} erros</span>
            )}
          </DetalheLinha>
          <DetalheLinha titulo="Fila">
            {agenteAberto?.pendentes ?? 0} pendentes
            {agenteAberto?.executando > 0 && (
              <span style={{ color: '#22c55e', marginLeft: 6 }}>· {agenteAberto.executando} executando</span>
            )}
          </DetalheLinha>
          <DetalheLinha titulo="Cron">
            {agenteAberto?.cron_ativo ? <span style={{ color: '#22c55e' }}>ATIVO</span> : 'manual'}
          </DetalheLinha>
          {agenteAberto?.ultimo_erro && (
            <div style={{
              marginTop: 10, padding: '8px 10px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 6, fontSize: 11, color: '#fecaca',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Último erro</div>
              <div style={{ wordBreak: 'break-word', opacity: 0.85 }}>{agenteAberto.ultimo_erro}</div>
            </div>
          )}
        </div>
      )}

      <Canvas
        shadows
        orthographic
        camera={{ position: [18, 18, 18], zoom: 36, near: 0.1, far: 200 }}
        style={{ background: 'linear-gradient(180deg, #3a2818 0%, #1f140a 100%)' }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight
          position={[12, 20, 8]} intensity={1.2}
          castShadow
          shadow-mapSize-width={2048} shadow-mapSize-height={2048}
          shadow-camera-left={-22} shadow-camera-right={22}
          shadow-camera-top={22} shadow-camera-bottom={-22}
        />
        <hemisphereLight args={['#fff5db', '#4a3a2a', 0.45]} />

        <Floor size={FLOOR_SIZE} />
        <Walls size={FLOOR_SIZE} height={3.5} />
        <Mobilia />

        <AreaCafe center={[-7, 0, -6]} />
        <CoffeeMachine position={[-7, 0, -6]} />
        <Printer position={[8, 0, -7]} />

        {EQUIPE.map(a => (
          <Desk key={`desk-${a.nome}`} position={a.deskPos} color={a.nome === 'maestro' ? '#7c5cff' : '#22d3ee'} />
        ))}
        {EQUIPE.map(a => (
          <Chair key={`chair-${a.nome}`} position={[a.deskPos[0], 0, a.deskPos[2] + SEAT_OFFSET]} />
        ))}

        {EQUIPE.map(a => (
          <VoxelAgent
            key={`agent-${a.nome}`}
            name={a.label}
            position={[a.deskPos[0], 0, a.deskPos[2] + SEAT_OFFSET]}
            status={statusDoAgente(a.nome)}
            shirtColor={a.shirtColor}
            phaseOffset={a.phaseOffset}
            paused={paused}
            seated={seatedDoAgente(a.nome)}
            walkTargets={a.walkRoute}
            walkSpeed={a.walkSpeed}
            agentInfo={agenteData[a.nome]}
            descricao={a.descricao}
            onSelect={() => setAgenteSelecionado(a.nome)}
            selected={agenteSelecionado === a.nome}
          />
        ))}

        <OrbitControls enablePan enableRotate enableZoom minZoom={20} maxZoom={80} />
      </Canvas>
    </div>
  );
}

function DetalheLinha({ titulo, children }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 0', borderBottom: '1px dashed #2a2f3a',
    }}>
      <span style={{ color: '#9ca3af' }}>{titulo}</span>
      <span style={{ color: '#e5e7eb' }}>{children}</span>
    </div>
  );
}
