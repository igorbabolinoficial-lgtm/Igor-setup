import React, { useRef, useMemo, Suspense, Component } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  ContactShadows,
  Environment,
  MeshReflectorMaterial,
  RoundedBox,
  Sky,
  useTexture,
  useGLTF,
} from '@react-three/drei';

/* Pré-carrega GLBs (não bloqueia, só prepara cache) */
['/models/house_cabin.glb', '/models/house_chalet.glb', '/models/house_farm.glb',
 '/models/house_large.glb', '/models/house_town.glb',
 '/models/tree_palm_1.glb', '/models/tree_palm_2.glb'].forEach((u) => {
  try { useGLTF.preload(u); } catch {}
});

/* Componente que carrega e clona um GLB. Usar dentro de Suspense + TextureBoundary. */
function GLBModel({ url, position = [0, 0, 0], scale = 1, rotation = [0, 0, 0] }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  // garante que receba/projete sombras
  useMemo(() => {
    cloned.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
  }, [cloned]);
  return <primitive object={cloned} position={position} scale={scale} rotation={rotation} />;
}

/* =============================================================
   FLAG: ativa quando os 4 arquivos JPG estiverem em public/textures/
   Quando false (ou se algum arquivo faltar), cai no canvas procedural.
   ============================================================= */
const USE_REAL_TEXTURES = true;

/* Boundary local que captura erro do useTexture e devolve o fallback */
class TextureBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { /* eslint-disable-next-line no-console */ console.warn('[textures] fallback procedural:', err?.message); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
import { EffectComposer, Bloom, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';

/* =============================================================
   PRNG determinístico (pra livros e folhas não dançarem entre frames)
   ============================================================= */
const rand = (seed) => {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

/* =============================================================
   Materiais
   ============================================================= */
/* =============================================================
   Materiais Simplificados
   ============================================================= */
const GLASS = {
  color: '#ffffff',
  transparent: true,
  opacity: 0.4,
};

const CAR_PAINT = (color) => ({
  color,
  roughness: 0.5,
  metalness: 0.5,
});

/* =============================================================
   CARRO SIMPLIFICADO
   ============================================================= */
function LuxuryCar({ position, color = '#0b1220', rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[2, 0.55, 4.6]} />
        <meshStandardMaterial {...CAR_PAINT(color)} />
      </mesh>
      <mesh position={[0, 0.95, -0.25]}>
        <boxGeometry args={[1.78, 0.6, 2.4]} />
        <meshStandardMaterial {...CAR_PAINT(color)} />
      </mesh>
      {/* Vidros simples */}
      <mesh position={[0, 1.0, 0.95]} rotation={[0.55, 0, 0]}>
        <planeGeometry args={[1.6, 0.75]} />
        <meshStandardMaterial {...GLASS} side={THREE.DoubleSide} />
      </mesh>
      {/* Rodas simples */}
      {[[ -0.95, 0.36, 1.45], [0.95, 0.36, 1.45], [-0.95, 0.36, -1.45], [0.95, 0.36, -1.45]].map((p, i) => (
        <mesh key={i} position={p} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.36, 0.36, 0.24, 12]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
    </group>
  );
}

/* =============================================================
   MÓVEIS SIMPLIFICADOS
   ============================================================= */
function PremiumSofa({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[2.6, 0.6, 1.1]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
    </group>
  );
}

function PremiumBed({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[2, 0.7, 2.4]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
    </group>
  );
}

/* =============================================================
   MESA DE JANTAR
   ============================================================= */
function DiningSet({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[2.6, 0.04, 1.2]} />
        <meshPhysicalMaterial {...GLASS} />
      </mesh>
      <RoundedBox args={[2.4, 0.03, 1]} radius={0.01} position={[0, 0.73, 0]}>
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.3} />
      </RoundedBox>
      {[[-1.15, 0.37, 0], [1.15, 0.37, 0]].map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <boxGeometry args={[0.06, 0.72, 0.9]} />
          <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {[
        [-0.85, 0, 0.95],
        [0, 0, 0.95],
        [0.85, 0, 0.95],
        [-0.85, 0, -0.95],
        [0, 0, -0.95],
        [0.85, 0, -0.95],
      ].map((p, i) => (
        <group key={i} position={p} rotation={[0, p[2] > 0 ? Math.PI : 0, 0]}>
          <RoundedBox args={[0.45, 0.04, 0.42]} radius={0.04} position={[0, 0.45, 0]} castShadow>
            <meshStandardMaterial color="#1e293b" roughness={0.8} />
          </RoundedBox>
          <RoundedBox args={[0.45, 0.55, 0.05]} radius={0.04} position={[0, 0.73, -0.18]} castShadow>
            <meshStandardMaterial color="#1e293b" roughness={0.8} />
          </RoundedBox>
          {[[-0.18, 0.22, 0.18], [0.18, 0.22, 0.18], [-0.18, 0.22, -0.18], [0.18, 0.22, -0.18]].map((q, j) => (
            <mesh key={j} position={q} castShadow>
              <cylinderGeometry args={[0.022, 0.022, 0.44, 10]} />
              <meshStandardMaterial color="#0a0a0a" metalness={0.7} roughness={0.3} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* =============================================================
   LUSTRE DE CRISTAL — cluster de gotas com bloom
   ============================================================= */
function CrystalChandelier({ position }) {
  const drops = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 28; i++) {
      const angle = rand(i * 13) * Math.PI * 2;
      const radius = 0.15 + rand(i * 7) * 0.35;
      const y = -rand(i * 5) * 0.5;
      arr.push([Math.cos(angle) * radius, y, Math.sin(angle) * radius, 0.04 + rand(i * 3) * 0.04]);
    }
    return arr;
  }, []);
  return (
    <group position={position}>
      {/* Cabo */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.8, 8]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
      {/* Anel metálico */}
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.02, 12, 32]} />
        <meshStandardMaterial color="#d4af37" metalness={0.95} roughness={0.15} />
      </mesh>
      {/* Gotas de cristal */}
      {drops.map((d, i) => (
        <mesh key={i} position={[d[0], d[1], d[2]]}>
          <sphereGeometry args={[d[3], 16, 16]} />
          <meshPhysicalMaterial
            color="#ffffff"
            transmission={0.95}
            roughness={0.03}
            thickness={0.4}
            ior={2.0}
            transparent
            opacity={0.6}
          />
        </mesh>
      ))}
      {/* Lâmpada central */}
      <mesh position={[0, -0.1, 0]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshStandardMaterial color="#fef3c7" emissive="#fbbf24" emissiveIntensity={1.2} />
      </mesh>
      <pointLight position={[0, -0.2, 0]} intensity={2.5} distance={8} color="#fde68a" castShadow />
    </group>
  );
}

/* =============================================================
   DECORAÇÃO BÁSICA
   ============================================================= */
function Rug({ position, size = [3.5, 2.5], color = '#1e293b' }) {
  return (
    <mesh position={[position[0], 0.02, position[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={size} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}

function TVConsole({ position }) {
  return (
    <group position={position}>
      <RoundedBox args={[2.4, 0.4, 0.45]} radius={0.04} position={[0, 0.2, 0]} castShadow>
        <meshStandardMaterial color="#0a0a0a" roughness={0.4} metalness={0.2} />
      </RoundedBox>
      <RoundedBox args={[2.1, 1.18, 0.06]} radius={0.02} position={[0, 1.1, 0.05]} castShadow>
        <meshStandardMaterial color="#000" />
      </RoundedBox>
      <mesh position={[0, 1.1, 0.085]}>
        <planeGeometry args={[2, 1.1]} />
        <meshStandardMaterial color="#0c1226" emissive="#1d4ed8" emissiveIntensity={0.3} roughness={0.2} />
      </mesh>
      {/* Soundbar */}
      <RoundedBox args={[1.8, 0.08, 0.12]} radius={0.02} position={[0, 0.43, 0.18]}>
        <meshStandardMaterial color="#1f2937" roughness={0.4} />
      </RoundedBox>
    </group>
  );
}

/* =============================================================
   PALMEIRA (rooftop)
   ============================================================= */
function Palm({ position, scale = 1, seed = 1 }) {
  return (
    <group position={position} scale={scale}>
      {/* Vaso */}
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.35, 0.28, 0.5, 24]} />
        <meshStandardMaterial color="#e7e5e4" roughness={0.7} />
      </mesh>
      {/* Tronco */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={i} position={[0, 0.7 + i * 0.35, 0]} castShadow>
          <cylinderGeometry args={[0.09 - i * 0.005, 0.11 - i * 0.005, 0.36, 12]} />
          <meshStandardMaterial color="#78350f" roughness={0.9} />
        </mesh>
      ))}
      {/* Coroa de folhas */}
      {Array.from({ length: 9 }).map((_, i) => {
        const a = (i / 9) * Math.PI * 2;
        const tilt = 0.6 + rand(seed * 100 + i) * 0.3;
        return (
          <group key={i} position={[0, 3.6, 0]} rotation={[0, a, -tilt]}>
            {/* Pencil/talo */}
            <mesh position={[0.8, 0, 0]} castShadow>
              <boxGeometry args={[1.6, 0.04, 0.08]} />
              <meshStandardMaterial color="#15803d" roughness={0.85} />
            </mesh>
            {/* Folíolos ao longo do talo */}
            {Array.from({ length: 14 }).map((_, j) => {
              const t = j / 13;
              const x = 0.15 + t * 1.5;
              const len = 0.5 - Math.abs(t - 0.4) * 0.4;
              return (
                <mesh key={j} position={[x, 0, j % 2 ? 0.15 : -0.15]} rotation={[0, j % 2 ? 0.4 : -0.4, 0.2]} castShadow>
                  <boxGeometry args={[len, 0.02, 0.08]} />
                  <meshStandardMaterial color={j % 3 === 0 ? '#166534' : '#16a34a'} roughness={0.9} side={THREE.DoubleSide} />
                </mesh>
              );
            })}
          </group>
        );
      })}
      {/* Coco */}
      {Array.from({ length: 4 }).map((_, i) => {
        const a = (i / 4) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.18, 3.4, Math.sin(a) * 0.18]} castShadow>
            <sphereGeometry args={[0.13, 12, 12]} />
            <meshStandardMaterial color="#44403c" roughness={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

/* =============================================================
   MONSTERA / FICUS (living)
   ============================================================= */
function Monstera({ position, scale = 1, seed = 7 }) {
  return (
    <group position={position} scale={scale}>
      {/* Vaso cônico */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.22, 0.6, 24]} />
        <meshStandardMaterial color="#1c1917" roughness={0.4} metalness={0.1} />
      </mesh>
      {/* Talos */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = rand(seed + i) * Math.PI * 2;
        const tilt = 0.4 + rand(seed + i * 2) * 0.5;
        const h = 1.0 + rand(seed + i * 3) * 0.8;
        return (
          <group key={i} position={[0, 0.6, 0]} rotation={[0, a, tilt]}>
            <mesh position={[0, h / 2, 0]} castShadow>
              <cylinderGeometry args={[0.02, 0.02, h, 8]} />
              <meshStandardMaterial color="#166534" roughness={0.85} />
            </mesh>
            {/* Folha grande no topo */}
            <mesh position={[0, h, 0]} rotation={[Math.PI / 2 - 0.3, 0, 0]} castShadow>
              <planeGeometry args={[0.55, 0.7, 4, 4]} />
              <meshStandardMaterial color={i % 2 ? '#16a34a' : '#15803d'} roughness={0.85} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* =============================================================
   LUMINÁRIA DE PISO
   ============================================================= */
function FloorLamp({ position }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.03, 24]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1, 0]} castShadow>
        <cylinderGeometry args={[0.015, 0.015, 1.9, 8]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.95, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.25, 0.3, 24]} />
        <meshStandardMaterial color="#f5f5f4" emissive="#fde68a" emissiveIntensity={0.2} />
      </mesh>
      <pointLight position={[0, 2.0, 0]} intensity={1.6} distance={5} color="#fde68a" />
    </group>
  );
}

function Painting({ position, rotation = [0, 0, 0], color = '#fbbf24' }) {
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[1.4, 0.9, 0.05]} radius={0.01} castShadow>
        <meshStandardMaterial color="#0a0a0a" />
      </RoundedBox>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[1.3, 0.8]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
    </group>
  );
}

function Curtains({ position, width = 6 }) {
  const count = 12;
  return (
    <group position={position}>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i} position={[(i - (count - 1) / 2) * (width / count), 0, 0]} castShadow>
          <boxGeometry args={[(width / count) * 0.95, 2.8, 0.04]} />
          <meshStandardMaterial color="#f1f5f9" roughness={1} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/* =============================================================
   ESTANTE DE LIVROS
   ============================================================= */
function Bookshelf({ position, rotation = [0, 0, 0] }) {
  const palette = ['#7c2d12', '#1e3a8a', '#0f766e', '#365314', '#7c2d12', '#5b21b6', '#0a0a0a', '#a16207', '#9a3412', '#075985'];
  return (
    <group position={position} rotation={rotation}>
      {/* Lateral esquerda */}
      <mesh position={[-1.5, 1.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.06, 2.8, 0.4]} />
        <meshStandardMaterial color="#1c1917" roughness={0.6} />
      </mesh>
      {/* Lateral direita */}
      <mesh position={[1.5, 1.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.06, 2.8, 0.4]} />
        <meshStandardMaterial color="#1c1917" roughness={0.6} />
      </mesh>
      {/* Fundo */}
      <mesh position={[0, 1.4, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[3.06, 2.8, 0.04]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.7} />
      </mesh>
      {/* Prateleiras */}
      {[0.05, 0.7, 1.4, 2.1, 2.78].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[3, 0.04, 0.4]} />
          <meshStandardMaterial color="#1c1917" roughness={0.6} />
        </mesh>
      ))}
      {/* Livros por prateleira */}
      {[0.4, 1.05, 1.75].map((shelfY, shelfIdx) => {
        let x = -1.4;
        const items = [];
        let id = 0;
        while (x < 1.4) {
          const w = 0.06 + rand(shelfIdx * 100 + id) * 0.05;
          const h = 0.45 + rand(shelfIdx * 200 + id) * 0.2;
          const color = palette[Math.floor(rand(shelfIdx * 50 + id) * palette.length)];
          items.push(
            <mesh key={`${shelfIdx}-${id}`} position={[x + w / 2, shelfY + h / 2 - 0.25, 0]} castShadow>
              <boxGeometry args={[w, h, 0.28]} />
              <meshStandardMaterial color={color} roughness={0.85} />
            </mesh>
          );
          x += w + 0.005;
          id++;
        }
        return items;
      })}
      {/* Objetos decorativos na prateleira do topo */}
      <mesh position={[-1, 2.45, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.08, 0.35, 16]} />
        <meshStandardMaterial color="#d4af37" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[-0.6, 2.4, 0]} castShadow>
        <sphereGeometry args={[0.13, 24, 24]} />
        <meshPhysicalMaterial color="#fff" transmission={0.85} roughness={0.05} thickness={0.5} />
      </mesh>
      <mesh position={[0.8, 2.45, 0]} castShadow>
        <boxGeometry args={[0.4, 0.35, 0.25]} />
        <meshStandardMaterial color="#1c1917" roughness={0.6} />
      </mesh>
    </group>
  );
}

/* =============================================================
   ROOFTOP — guarda-sol, toalha, mesa de drinks
   ============================================================= */
function Umbrella({ position, color = '#f5f5f4' }) {
  return (
    <group position={position}>
      {/* Base/mastro */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.15, 24]} />
        <meshStandardMaterial color="#1c1917" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 2.5, 8]} />
        <meshStandardMaterial color="#1c1917" />
      </mesh>
      {/* Lona */}
      <mesh position={[0, 2.8, 0]} rotation={[0, 0, 0]} castShadow>
        <coneGeometry args={[1.6, 0.5, 8, 1]} />
        <meshStandardMaterial color={color} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* Ponteira */}
      <mesh position={[0, 3.12, 0]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial color="#d4af37" metalness={0.9} roughness={0.2} />
      </mesh>
    </group>
  );
}

function PoolSideTable({ position }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.25, 0.04, 24]} />
        <meshStandardMaterial color="#1c1917" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 8]} />
        <meshStandardMaterial color="#1c1917" />
      </mesh>
      {/* Drink 1 */}
      <mesh position={[-0.08, 0.55, 0.06]} castShadow>
        <cylinderGeometry args={[0.05, 0.04, 0.18, 16]} />
        <meshPhysicalMaterial color="#fff" transmission={0.7} roughness={0.05} thickness={0.3} transparent opacity={0.5} />
      </mesh>
      <mesh position={[-0.08, 0.5, 0.06]}>
        <cylinderGeometry args={[0.045, 0.038, 0.1, 16]} />
        <meshStandardMaterial color="#f97316" roughness={0.5} transparent opacity={0.85} />
      </mesh>
      {/* Drink 2 */}
      <mesh position={[0.1, 0.55, -0.05]} castShadow>
        <cylinderGeometry args={[0.05, 0.04, 0.18, 16]} />
        <meshPhysicalMaterial color="#fff" transmission={0.7} roughness={0.05} thickness={0.3} transparent opacity={0.5} />
      </mesh>
      <mesh position={[0.1, 0.5, -0.05]}>
        <cylinderGeometry args={[0.045, 0.038, 0.1, 16]} />
        <meshStandardMaterial color="#fbbf24" roughness={0.5} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function FoldedTowel({ position, color = '#fbbf24' }) {
  return (
    <group position={position}>
      <RoundedBox args={[0.6, 0.06, 0.4]} radius={0.02} castShadow>
        <meshStandardMaterial color={color} roughness={1} />
      </RoundedBox>
      <RoundedBox args={[0.6, 0.06, 0.4]} radius={0.02} position={[0, 0.07, 0.02]} castShadow>
        <meshStandardMaterial color={color === '#fbbf24' ? '#fde68a' : '#fff'} roughness={1} />
      </RoundedBox>
    </group>
  );
}

/* =============================================================
   CAUSTICS na superfície da piscina (shader inline)
   ============================================================= */
function PoolCaustics({ position, size }) {
  const mat = useRef();
  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={size} />
      <shaderMaterial
        ref={mat}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{ uTime: { value: 0 } }}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          varying vec2 vUv;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            float a = hash(i), b = hash(i + vec2(1,0));
            float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
            vec2 u = f*f*(3.0-2.0*f);
            return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
          }
          void main() {
            vec2 uv = vUv * 7.0;
            float t = uTime * 0.35;
            float v = 0.0;
            v += noise(uv + vec2(t, t*0.7));
            v += noise(uv * 2.1 - vec2(t*1.3, t)) * 0.6;
            v = pow(v * 0.55, 4.0);
            v = smoothstep(0.12, 0.55, v);
            gl_FragColor = vec4(0.8, 0.95, 1.0, v * 0.55);
          }
        `}
      />
    </mesh>
  );
}

/* =============================================================
   PAISAGEM EXTERNA — terreno, oceano, morros, arvoredo
   ============================================================= */
/* =============================================================
   TEXTURAS PROCEDURAIS — geradas via Canvas, não dependem de rede
   ============================================================= */
function makeNoiseTexture(size, baseColor, variations, density) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < density; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = Math.random();
    const idx = Math.floor(v * variations.length);
    ctx.fillStyle = variations[idx];
    const w = 1 + Math.random() * 1.5;
    const h = 1 + Math.random() * 2;
    ctx.globalAlpha = 0.4 + Math.random() * 0.5;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* =============================================================
   OCEANO DINÂMICO — shader inline: ondas + gradient + spray
   Aceita normalMap opcional pra ganhar relevo de superfície real
   ============================================================= */
const NEUTRAL_NORMAL = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8080ff'; // normal apontando direto pra cima
  ctx.fillRect(0, 0, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/* Normal map de água procedural — várias ondas senoidais sobrepostas convertidas em normal vector */
const PROCEDURAL_WATER_NORMAL = (() => {
  const SIZE = 256;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);

  // altura em cada pixel = soma de senos em direções diferentes (fbm leve)
  const height = (x, y) => {
    const u = (x / SIZE) * Math.PI * 2;
    const v = (y / SIZE) * Math.PI * 2;
    return (
      Math.sin(u * 3 + v * 1.5) * 0.5 +
      Math.cos(u * 7 - v * 4) * 0.3 +
      Math.sin(u * 15 + v * 12) * 0.15 +
      Math.cos(u * 28 - v * 22) * 0.07
    );
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const h = height(x, y);
      const dx = height(x + 1, y) - h;
      const dy = height(x, y + 1) - h;
      // normal = (-dx, -dy, 1) normalizado, mapeado pra 0..255
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * SIZE + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

function DynamicOcean({ position, size, normalMap }) {
  const matRef = useRef();
  const useNormal = normalMap ? 1 : 0;
  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size[0], size[1], 64, 32]} />
      <shaderMaterial
        ref={matRef}
        uniforms={{
          uTime: { value: 0 },
          uNormalMap: { value: normalMap || NEUTRAL_NORMAL },
          uUseNormal: { value: useNormal },
        }}
        vertexShader={`
          uniform float uTime;
          varying vec2 vUv;
          varying float vWave;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            float a = hash(i), b = hash(i + vec2(1,0));
            float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
            vec2 u = f*f*(3.0-2.0*f);
            return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
          }
          void main(){
            vUv = uv;
            vec3 p = position;
            float t = uTime * 0.5;
            float w1 = sin(p.x * 0.18 + t * 1.2) * 0.06;
            float w2 = cos(p.y * 0.12 + t * 0.9) * 0.05;
            float w3 = noise(p.xy * 0.3 + vec2(t * 0.3, t * 0.4)) * 0.08;
            float wave = w1 + w2 + w3;
            // Clamp: onda só SOBE (forma crista). Nunca desce abaixo do nível base.
            // Sem isso, vértices baixos faziam o mar afundar sob grama/areia → manchas de "buraco".
            float lifted = max(0.0, wave);
            p.z += lifted;
            vWave = lifted;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform sampler2D uNormalMap;
          uniform float uUseNormal;
          varying vec2 vUv;
          varying float vWave;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            float a = hash(i), b = hash(i + vec2(1,0));
            float c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
            vec2 u = f*f*(3.0-2.0*f);
            return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
          }
          void main(){
            vec3 shallow = vec3(0.32, 0.70, 0.92);   // azul claro perto da praia
            vec3 mid     = vec3(0.12, 0.45, 0.85);   // azul médio
            vec3 deep    = vec3(0.04, 0.18, 0.55);   // azul-marinho no horizonte

            float depthMix = smoothstep(0.0, 0.45, vUv.y);
            vec3 base = mix(shallow, mid, depthMix);
            base = mix(base, deep, smoothstep(0.4, 1.0, vUv.y));

            // Sampleia normal map duas vezes em direções opostas (deslocamento temporal)
            // pra simular ondas finas se cruzando
            vec2 nuv1 = vUv * 14.0 + vec2(uTime * 0.04, uTime * 0.02);
            vec2 nuv2 = vUv * 7.0  - vec2(uTime * 0.03, uTime * 0.05);
            vec3 n1 = texture2D(uNormalMap, nuv1).rgb * 2.0 - 1.0;
            vec3 n2 = texture2D(uNormalMap, nuv2).rgb * 2.0 - 1.0;
            vec3 nrm = normalize(n1 + n2);

            // Especular fake usando o z da normal (vetor "olho")
            float spec = pow(max(0.0, nrm.z), 24.0);
            base += vec3(1.0, 0.95, 0.82) * spec * 0.55 * uUseNormal;
            // Distorção tonal sutil do diffuse pela normal x
            base += nrm.x * 0.04 * uUseNormal;

            // Reflexo solar bem mais sutil
            float sunRef = pow(max(0.0, 1.0 - vUv.y * 1.2), 6.0) * 0.15;
            vec3 sunCol = vec3(1.0, 0.85, 0.7);
            base += sunCol * sunRef;

            // Cristas só nas ondas mais altas (threshold maior)
            float crest = smoothstep(0.15, 0.3, vWave);
            base += vec3(1.0, 0.95, 0.85) * crest * 0.2;

            // Foam quase imperceptível
            float foam = noise(vUv * 60.0 + uTime * 0.5) * smoothstep(0.2, 0.35, vWave);
            base += foam * 0.1;

            // Espuma da praia mais suave
            float shoreFoam = smoothstep(0.0, 0.04, vUv.y) * smoothstep(0.0, 1.0, 1.0 - vUv.y * 10.0);
            base = mix(base, vec3(1.0), shoreFoam * 0.35);

            // Opaco — evita buracos por valores negativos de alpha
            gl_FragColor = vec4(base, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/* Textura procedural de folhagem com MUITO MAIS contraste pra aparecer em esfera pequena */
const LEAF_TEXTURE = (() => {
  const SIZE = 256;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a8d3f';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tones = ['#1a3a1e', '#2a5a2c', '#7dcf85', '#8fe095', '#a0e8a5', '#1f4d22'];
  for (let i = 0; i < 7000; i++) {
    ctx.fillStyle = tones[Math.floor(Math.random() * tones.length)];
    ctx.globalAlpha = 0.7 + Math.random() * 0.3;
    const x = Math.random() * SIZE, y = Math.random() * SIZE;
    const w = 2 + Math.random() * 4;
    const h = 2 + Math.random() * 4;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(3, 3);
  return t;
})();

/* Textura procedural de casca de tronco */
const BARK_TEXTURE = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5d4037';
  ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 2000; i++) {
    const tones = ['#3e2723', '#6d4c41', '#4e342e', '#8d6e63'];
    ctx.fillStyle = tones[Math.floor(Math.random() * tones.length)];
    ctx.globalAlpha = 0.3 + Math.random() * 0.5;
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 1, 2 + Math.random() * 3);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 3);
  return t;
})();

/* =============================================================
   ÁRVORE estilo araucária (sul do Brasil) - cones empilhados
   ============================================================= */
function PineTree({ position, scale = 1, seed = 1 }) {
  const tilt = (rand(seed) - 0.5) * 0.1;
  return (
    <group position={position} scale={scale} rotation={[0, rand(seed * 2) * Math.PI * 2, tilt]}>
      {/* Tronco com textura de casca */}
      <mesh position={[0, 1.6, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.18, 3.2, 8]} />
        <meshStandardMaterial map={BARK_TEXTURE} color="#5d4037" roughness={0.95} />
      </mesh>
      {/* Folhagem em 4 níveis com textura procedural */}
      {[0, 1, 2, 3].map((i) => {
        const y = 2.2 + i * 0.55;
        const r = 1.5 - i * 0.32;
        const greens = ['#3a7a3e', '#48944a', '#56a85c', '#65b86a'];
        return (
          <mesh key={i} position={[0, y, 0]} castShadow>
            <coneGeometry args={[r, 1.2, 12]} />
            <meshStandardMaterial map={LEAF_TEXTURE} color={greens[i]} roughness={0.95} />
          </mesh>
        );
      })}
    </group>
  );
}

/* =============================================================
   ÁRVORE de mata atlântica - copa densa com múltiplas esferas
   ============================================================= */
function DenseTree({ position, scale = 1, seed = 1 }) {
  const tilt = (rand(seed) - 0.5) * 0.12;
  return (
    <group position={position} scale={scale} rotation={[0, rand(seed * 3) * Math.PI * 2, tilt]}>
      {/* Tronco com casca */}
      <mesh position={[0, 1.3, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.22, 2.6, 8]} />
        <meshStandardMaterial map={BARK_TEXTURE} color="#5d4037" roughness={0.95} />
      </mesh>
      {/* Galhos */}
      {[0.3, -0.4, 0.2].map((dx, i) => (
        <mesh key={i} position={[dx, 2 + i * 0.1, dx * 0.5]} rotation={[0, 0, dx * 1.5]} castShadow>
          <cylinderGeometry args={[0.04, 0.06, 0.8, 5]} />
          <meshStandardMaterial map={BARK_TEXTURE} color="#5d4037" roughness={0.95} />
        </mesh>
      ))}
      {/* Folhagem volumosa com textura procedural */}
      {Array.from({ length: 7 }).map((_, i) => {
        const a = (i / 7) * Math.PI * 2 + rand(seed + i) * 0.5;
        const r = 0.5 + rand(seed + i * 2) * 0.4;
        const x = Math.cos(a) * (0.4 + rand(seed + i * 3) * 0.4);
        const z = Math.sin(a) * (0.4 + rand(seed + i * 3) * 0.4);
        const y = 2.5 + rand(seed + i * 5) * 0.7;
        const greens = ['#3d8a40', '#4ea054', '#5ab062', '#6cc070', '#7dcf85'];
        const c = greens[Math.floor(rand(seed + i * 7) * greens.length)];
        return (
          <mesh key={i} position={[x, y, z]} castShadow>
            <sphereGeometry args={[r, 12, 10]} />
            <meshStandardMaterial map={LEAF_TEXTURE} color={c} roughness={0.95} />
          </mesh>
        );
      })}
    </group>
  );
}

/* Wrapper que carrega water_nor.jpg via useTexture e passa pro DynamicOcean.
   Forçado pra usar PROCEDURAL_WATER_NORMAL — o asset baixado era diffuse e dava buracos. */
function TexturedOcean({ position, size }) {
  return <DynamicOcean position={position} size={size} normalMap={PROCEDURAL_WATER_NORMAL} />;
}

/* =============================================================
   CHÃO COM TEXTURAS FOTOGRÁFICAS REAIS — só monta se USE_REAL_TEXTURES=true
   ============================================================= */
function RealisticGround() {
  const [, grassNor, sand] = useTexture([
    '/textures/grass_diff.jpg',
    '/textures/grass_nor.jpg',
    '/textures/sand_diff.jpg',
  ]);
  if (grassNor) { grassNor.wrapS = grassNor.wrapT = THREE.RepeatWrapping; grassNor.repeat.set(40, 40); }
  if (sand) { sand.colorSpace = THREE.SRGBColorSpace; sand.wrapS = sand.wrapT = THREE.RepeatWrapping; sand.repeat.set(18, 1.5); }

  return (
    <>
      {/* Gramado: verde oliva natural + relevo do normal map */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial
          normalMap={grassNor}
          color="#6b9844"
          roughness={1}
          normalScale={new THREE.Vector2(1.6, 1.6)}
        />
      </mesh>
      {/* Areia: cor dourada quente (não branca) */}
      <mesh position={[0, 0.04, -30]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[360, 18]} />
        <meshStandardMaterial color="#d9b87a" roughness={1} />
      </mesh>
    </>
  );
}

function Landscape() {
  /* Texturas procedurais (geradas uma vez no mount) */
  const grassTexture = useMemo(() => {
    const tex = makeNoiseTexture(
      256,
      '#7ec25a',
      ['#5fa340', '#9dd574', '#4e9530', '#a8e070', '#65b048'],
      8000
    );
    tex.repeat.set(60, 60);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  const sandTexture = useMemo(() => {
    const tex = makeNoiseTexture(
      256,
      '#f4e9c8',
      ['#e8d9a8', '#f7eece', '#decba8', '#d4b978', '#fff5dc'],
      8000
    );
    tex.repeat.set(20, 2);
    return tex;
  }, []);

  /* Árvores espalhadas (densidade reduzida agora que vão ser GLB) */
  const trees = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 55; i++) {
      const angle = rand(i * 7) * Math.PI * 2;
      const radius = 22 + rand(i * 11) * 45;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.abs(x) < 14 && Math.abs(z) < 16) continue;
      if (z < -22) continue;
      if (Math.abs(x - 30) < 2.5 || Math.abs(x + 30) < 2.5) continue;
      if (Math.abs(z + 14) < 2.5) continue;
      if (Math.abs(z - 26) < 2) continue;
      // não em cima das casas (raio 5 ao redor de cada casa)
      const houseSpots = [[-80, -10], [-65, -10], [50, -10], [65, -10], [80, -10], [-78, 38], [78, 38], [-72, 52], [72, 52]];
      let nearHouse = false;
      for (const [hx, hz] of houseSpots) {
        if ((x - hx) ** 2 + (z - hz) ** 2 < 64) { nearHouse = true; break; }
      }
      if (nearHouse) continue;
      arr.push({ x, z, r: 0.85 + rand(i * 23) * 0.6, useAlt: rand(i * 31) > 0.5 });
    }
    return arr;
  }, []);

  /* Morros como silhuetas distantes atrás do mar */
  const hills = useMemo(() => {
    return [
      { x: -90, z: -130, r: 18, h: 8, c: '#3a6b3e' },
      { x: -45, z: -140, r: 22, h: 11, c: '#2d5a32' },
      { x: 15, z: -145, r: 26, h: 13, c: '#3a6b3e' },
      { x: 65, z: -135, r: 20, h: 9, c: '#2d5a32' },
      { x: 110, z: -125, r: 16, h: 7, c: '#3a6b3e' },
    ];
  }, []);

  /* Chão procedural (canvas) - usado quando flag estiver false ou texturas falharem */
  const proceduralGround = (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial map={grassTexture} color="#5a8a2e" roughness={1} />
      </mesh>
      <mesh position={[0, 0.04, -30]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[360, 18]} />
        <meshStandardMaterial map={sandTexture} color="#f4e9c8" roughness={1} />
      </mesh>
    </>
  );

  return (
    <group position={[0, -12.95, 0]}>
      {/* CHÃO: tenta texturas reais; se falhar/flag off, usa procedural */}
      {USE_REAL_TEXTURES ? (
        <TextureBoundary fallback={proceduralGround}>
          <Suspense fallback={proceduralGround}>
            <RealisticGround />
          </Suspense>
        </TextureBoundary>
      ) : (
        proceduralGround
      )}

      {/* Calçada ao redor do prédio */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[24, 28]} />
        <meshStandardMaterial color="#a8a29e" roughness={0.9} />
      </mesh>

      {/* Caminho até a entrada */}
      <mesh position={[0, 0.03, 15]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3, 12]} />
        <meshStandardMaterial color="#d6d3d1" roughness={0.9} />
      </mesh>

      {/* OCEANO — tenta normal map fotográfico; se faltar, usa normal map procedural canvas */}
      {USE_REAL_TEXTURES ? (
        <TextureBoundary
          fallback={
            <DynamicOcean position={[0, 0.15, -75]} size={[420, 100]} normalMap={PROCEDURAL_WATER_NORMAL} />
          }
        >
          <Suspense
            fallback={
              <DynamicOcean position={[0, 0.15, -75]} size={[420, 100]} normalMap={PROCEDURAL_WATER_NORMAL} />
            }
          >
            <TexturedOcean position={[0, 0.15, -75]} size={[420, 100]} />
          </Suspense>
        </TextureBoundary>
      ) : (
        <DynamicOcean position={[0, 0.15, -75]} size={[420, 100]} normalMap={PROCEDURAL_WATER_NORMAL} />
      )}

      {/* Morros vegetação - sphere semi-enterrada + camadas tonais */}
      {hills.map((h, i) => (
        <group key={i} position={[h.x, 0, h.z]}>
          <mesh position={[0, h.h * 0.3, 0]} castShadow>
            <sphereGeometry args={[h.r, 16, 12]} />
            <meshStandardMaterial color={h.c} roughness={1} />
          </mesh>
          <mesh position={[h.r * 0.2, h.h * 0.5, -h.r * 0.15]} castShadow>
            <sphereGeometry args={[h.r * 0.7, 12, 10]} />
            <meshStandardMaterial color="#14532d" roughness={1} />
          </mesh>
        </group>
      ))}

      {/* Árvores: palmeiras GLB alternadas (tree_palm_1 e tree_palm_2) */}
      <Suspense fallback={null}>
        {trees.map((t, i) => (
          <GLBModel
            key={i}
            url={t.useAlt ? '/models/tree_palm_2.glb' : '/models/tree_palm_1.glb'}
            position={[t.x, 0, t.z]}
            scale={0.22 + t.r * 0.08}
            rotation={[0, rand(i * 41) * Math.PI * 2, 0]}
          />
        ))}
      </Suspense>

      {/* RUAS - asfalto cinza escuro atravessando o terreno */}
      {/* Rua principal leste-oeste atrás do prédio */}
      <mesh position={[0, 0.025, -14]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[220, 4]} />
        <meshStandardMaterial color="#3a3735" roughness={0.95} />
      </mesh>
      {/* Rua norte-sul leste */}
      <mesh position={[30, 0.024, 6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4, 80]} />
        <meshStandardMaterial color="#3a3735" roughness={0.95} />
      </mesh>
      {/* Rua norte-sul oeste */}
      <mesh position={[-30, 0.024, 6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4, 80]} />
        <meshStandardMaterial color="#3a3735" roughness={0.95} />
      </mesh>
      {/* Travessa leste-oeste passando pelas casas */}
      <mesh position={[0, 0.024, 26]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 3.5]} />
        <meshStandardMaterial color="#3a3735" roughness={0.95} />
      </mesh>

      {/* Faixas tracejadas amarelas na rua principal (visual estradinha) */}
      {Array.from({ length: 20 }).map((_, i) => (
        <mesh key={`stripe-${i}`} position={[(i - 9.5) * 11, 0.026, -14]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[3, 0.18]} />
          <meshStandardMaterial color="#f5dd5b" roughness={0.9} />
        </mesh>
      ))}

      {/* CASAS GLB - SÓ na periferia bem afastada (raio mínimo 60), alinhadas com ruas externas */}
      <Suspense fallback={null}>
        {[
          // x, z, scale, rotY, modelo
          [-80, -10, 0.4, 0, 'farm'],
          [-65, -10, 0.4, 0, 'cabin'],
          [50, -10, 0.4, 0, 'farm'],
          [65, -10, 0.4, 0, 'town'],
          [80, -10, 0.4, 0, 'cabin'],
          [-95, 28, 0.38, 0.3, 'large'],
          [95, 28, 0.38, -0.3, 'large'],
          [-78, 38, 0.4, 0.2, 'cabin'],
          [78, 38, 0.4, -0.2, 'farm'],
          [-72, 52, 0.32, 0, 'chalet'],
          [72, 52, 0.32, 0, 'chalet'],
          [-100, 8, 0.4, 0.1, 'town'],
          [100, 8, 0.4, -0.1, 'town'],
        ].map(([x, z, s, rot, model], i) => (
          <GLBModel
            key={`house-${i}`}
            url={`/models/house_${model}.glb`}
            position={[x, 0, z]}
            scale={s}
            rotation={[0, rot, 0]}
          />
        ))}
      </Suspense>

      {/* Postes na calçada de chegada */}
      {[[-4.5, 8], [4.5, 8], [-4.5, 18], [4.5, 18]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.6, 0]} castShadow>
            <cylinderGeometry args={[0.04, 0.05, 3.2, 8]} />
            <meshStandardMaterial color="#0a0a0a" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 3.3, 0]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial color="#fef3c7" emissive="#fbbf24" emissiveIntensity={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* =============================================================
   SHELL DO PAVIMENTO
   ============================================================= */
function FloorShell({ isPenthouse = false }) {
  const W = 12;
  const D = 16;
  const H = 3;
  return (
    <group>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[W + 0.4, 0.1, D + 0.4]} />
        <meshStandardMaterial color="#e7e5e4" />
      </mesh>

      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#b8b3ad" />
      </mesh>

      {[
        [0, 0.05, D / 2 - 0.05, W, 0.1, 0.05],
        [0, 0.05, -D / 2 + 0.05, W, 0.1, 0.05],
        [-W / 2 + 0.05, 0.05, 0, 0.05, 0.1, D],
        [W / 2 - 0.05, 0.05, 0, 0.05, 0.1, D],
      ].map((p, i) => (
        <mesh key={i} position={[p[0], p[1], p[2]]}>
          <boxGeometry args={[p[3], p[4], p[5]]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
      ))}

      {!isPenthouse && (
        <>
          <group position={[0, H / 2, -D / 2]}>
            <mesh position={[0, H / 2 - 0.2, 0]}>
              <boxGeometry args={[W, 0.4, 0.25]} />
              <meshStandardMaterial color="#ece7e0" />
            </mesh>
            <mesh position={[0, -H / 2 + 0.35, 0]}>
              <boxGeometry args={[W, 0.7, 0.25]} />
              <meshStandardMaterial color="#ece7e0" />
            </mesh>
            <mesh position={[0, 0.05, 0.05]}>
              <boxGeometry args={[W - 0.4, H - 1.1, 0.05]} />
              <meshStandardMaterial {...GLASS} />
            </mesh>
          </group>

          <mesh position={[-W / 2, H / 2, 0]}>
            <boxGeometry args={[0.2, H, D]} />
            <meshStandardMaterial color="#ece7e0" />
          </mesh>

          <group position={[W / 2, H / 2, 0]}>
            <mesh>
              <boxGeometry args={[0.2, H, D]} />
              <meshStandardMaterial color="#7c2d12" />
            </mesh>
          </group>

          <group position={[0, H / 2, D / 2]}>
            <mesh position={[-W / 4, 0, 0]}>
              <boxGeometry args={[W / 2, H, 0.2]} />
              <meshStandardMaterial color="#ece7e0" />
            </mesh>
            <mesh position={[W / 4 + 0.6, 0, 0]}>
              <boxGeometry args={[W / 2 - 1.2, H, 0.2]} />
              <meshStandardMaterial color="#ece7e0" />
            </mesh>
            <mesh position={[1.5, H / 2 - 0.25, 0]}>
              <boxGeometry args={[1.2, 0.5, 0.2]} />
              <meshStandardMaterial color="#ece7e0" />
            </mesh>
            <mesh position={[1.5, -0.4, 0.02]}>
              <boxGeometry args={[1.0, 2.0, 0.06]} />
              <meshStandardMaterial color="#1c1917" />
            </mesh>
          </group>
        </>
      )}

      <group position={[0, 0, -D / 2 - 1.5]}>
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[W, 0.1, 3]} />
          <meshStandardMaterial color="#a8a29e" />
        </mesh>
      </group>

      {isPenthouse && (
        <group position={[0, 0.02, 0]}>
          {Array.from({ length: 16 }).map((_, i) => (
            <mesh key={i} position={[0, 0.005, (i - 7.5) * (D / 16)]} receiveShadow>
              <boxGeometry args={[W - 0.4, 0.02, (D / 16) * 0.92]} />
              <meshStandardMaterial color={i % 2 === 0 ? '#78350f' : '#92400e'} roughness={0.85} />
            </mesh>
          ))}
          <group position={[0, 0, 2]}>
            <mesh position={[0, -0.4, 0]} receiveShadow>
              <boxGeometry args={[7, 0.8, 4]} />
              <meshStandardMaterial color="#0c4a6e" roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[6.6, 3.6]} />
              <MeshReflectorMaterial
                blur={[300, 100]}
                resolution={512}
                mixBlur={2}
                mixStrength={8}
                roughness={0.25}
                depthScale={0.5}
                color="#0ea5e9"
                metalness={0.15}
              />
            </mesh>
            <PoolCaustics position={[0, 0.07, 2]} size={[6.6, 3.6]} />
            {[
              [0, 0.04, 1.9, 7.4, 0.05, 0.4],
              [0, 0.04, -1.9, 7.4, 0.05, 0.4],
              [3.7, 0.04, 0, 0.4, 0.05, 4.2],
              [-3.7, 0.04, 0, 0.4, 0.05, 4.2],
            ].map((p, i) => (
              <mesh key={i} position={[p[0], p[1], p[2]]} receiveShadow>
                <boxGeometry args={[p[3], p[4], p[5]]} />
                <meshStandardMaterial color="#e7e5e4" roughness={0.6} />
              </mesh>
            ))}
          </group>
          {[-2.5, 2.5].map((x, i) => (
            <group key={i} position={[x, 0.05, -4]} rotation={[0, x > 0 ? -0.2 : 0.2, 0]}>
              <RoundedBox args={[0.7, 0.1, 1.8]} radius={0.04} castShadow>
                <meshStandardMaterial color="#f5f5f4" roughness={0.9} />
              </RoundedBox>
              <RoundedBox args={[0.7, 0.1, 0.8]} radius={0.04} position={[0, 0.25, -0.6]} rotation={[-0.5, 0, 0]} castShadow>
                <meshStandardMaterial color="#f5f5f4" roughness={0.9} />
              </RoundedBox>
              <FoldedTowel position={[0, 0.13, 0.4]} color={i === 0 ? '#fbbf24' : '#7c2d12'} />
            </group>
          ))}
          {/* Guarda-sol entre as espreguiçadeiras */}
          <Umbrella position={[0, 0, -4]} color="#1c1917" />
          {/* Mesa de drinks */}
          <PoolSideTable position={[0, 0, -3]} />
        </group>
      )}
    </group>
  );
}

/* =============================================================
   FLOOR (scroll-driven)
   ============================================================= */
function Floor({ children, yOffset, isPenthouse, scrollRef, index = 0 }) {
  const group = useRef();
  const MAX_SEP = 5;

  useFrame(() => {
    if (!group.current) return;
    const t = scrollRef?.current ?? 0;
    const phase = Math.sin(Math.PI * t);              // 0 → 1 → 0 ao longo de t
    const eased = phase * phase * (3 - 2 * phase);    // smoothstep
    const extra = eased * MAX_SEP * index;
    group.current.position.y = yOffset + extra;
  });

  return (
    <group ref={group} position={[0, yOffset, 0]}>
      <FloorShell isPenthouse={isPenthouse} />
      {children}
    </group>
  );
}

/* =============================================================
   CÂMERA CINEMATOGRÁFICA
   ============================================================= */
/* Keyframes cinematográficos sincronizados com a explosão:
   - 0.00 prédio fechado, drone longe
   - 0.25 prédio começa a abrir, câmera aproxima
   - 0.50 prédio TOTALMENTE explodido, câmera vai pro alto pra ver de cima
   - 0.75 prédio fechando, câmera desce e cruza a varanda
   - 1.00 prédio fechado de novo, câmera parada olhando o mar */
const CAMERA_KEYS = [
  { pos: [44, 20, 38], look: [0, -6, 0] },
  { pos: [34, 24, 28], look: [0, 0, 0] },
  { pos: [22, 36, 22], look: [0, 6, 0] },
  { pos: [10, 8, 14], look: [0, 1, -8] },
  { pos: [0, 1.4, 1.5], look: [0, 1.6, -90] },
];

function lerp3(a, b, e) {
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
}

function CinematicCamera({ scrollRef }) {
  const smoothed = useRef(0);
  const time = useRef(0);
  useFrame((state, delta) => {
    time.current += delta;
    const target = scrollRef?.current ?? 0;
    smoothed.current += (target - smoothed.current) * Math.min(1, delta * 3.5);
    const t = smoothed.current;

    const segCount = CAMERA_KEYS.length - 1;
    const idx = Math.min(segCount - 1, Math.floor(t * segCount));
    const segT = Math.max(0, Math.min(1, t * segCount - idx));
    const e = segT * segT * (3 - 2 * segT); // smoothstep

    const pos = lerp3(CAMERA_KEYS[idx].pos, CAMERA_KEYS[idx + 1].pos, e);
    const look = lerp3(CAMERA_KEYS[idx].look, CAMERA_KEYS[idx + 1].look, e);

    // breathing leve quando parado pra não ficar morto
    const idle = Math.max(0, 1 - Math.abs(target - smoothed.current) * 200);
    const breath = Math.sin(time.current * 0.4) * 0.08 * idle * (1 - t);

    state.camera.position.set(pos[0] + breath, pos[1] + breath * 0.5, pos[2] - breath);
    state.camera.lookAt(look[0], look[1], look[2]);
  });
  return null;
}

/* =============================================================
   SHOWCASE 3D — recebe scrollRef (0..1) e prop quality
   ============================================================= */
export default function Showcase3D({ scrollRef, quality = 'hi' }) {
  // Dia claro, sol alto
  const sunPos = [35, 50, -20];
  const isLite = true; // FORÇADO PARA TESTE DE COMPATIBILIDADE
  const dpr = [1, 1]; // Bloqueado em 1x para não pesar

  return (
    <Canvas
      shadows={false} // Desativado para garantir carregamento
      dpr={dpr}
      camera={{ position: [38, 22, 38], fov: 28 }}
      gl={{ antialias: true, toneMappingExposure: 1.5, powerPreference: 'high-performance' }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Céu de dia claro */}
      <Sky
        distance={4500}
        sunPosition={sunPos}
        turbidity={8}
        rayleigh={1.5}
        mieCoefficient={0.005}
        mieDirectionalG={0.85}
      />

      {/* Iluminação de meio-dia bem clara */}
      <ambientLight intensity={1.1} color="#eaf2ff" />
      <hemisphereLight args={['#cfe4ff', '#5a4a3a', 1.0]} />

      <directionalLight
        position={sunPos}
        intensity={3.2}
        color="#fff5dc"
        castShadow={!isLite}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      <directionalLight position={[-20, 12, 30]} intensity={0.5} color="#bcd5f0" />

      <Landscape />

      {!isLite && (
        <ContactShadows
          position={[0, -12.94, 0]}
          opacity={0.4}
          scale={50}
          blur={3}
          far={15}
        />
      )}

      <CinematicCamera scrollRef={scrollRef} />

      <Floor yOffset={-12.95} index={0} scrollRef={scrollRef}>
        <LuxuryCar position={[-2.5, 0, -2]} color="#0b1220" />
        <LuxuryCar position={[2.5, 0, 2]} color="#7f1d1d" rotation={[0, Math.PI, 0]} />
        <Suspense fallback={null}>
          <GLBModel url="/models/tree_palm_1.glb" position={[-5, 0, 6]} scale={0.2} />
          <GLBModel url="/models/tree_palm_2.glb" position={[5.5, 0, -7]} scale={0.22} />
        </Suspense>
      </Floor>

      <Floor yOffset={-9} index={1} scrollRef={scrollRef}>
        <Rug position={[-2, 0, -1]} size={[4.5, 3]} color="#1c1917" />
        <PremiumSofa position={[-2, 0, -0.5]} rotation={[0, Math.PI / 8, 0]} />
        <TVConsole position={[-2, 0, -4]} />
        <DiningSet position={[3, 0, 3]} />
        <CrystalChandelier position={[3, 2.6, 3]} />
        <FloorLamp position={[0, 0, -3.5]} />
        <Bookshelf position={[-5.4, 0, 5]} rotation={[0, Math.PI / 2, 0]} />
        <Monstera position={[5, 0, -6.5]} scale={1.1} seed={11} />
        <Monstera position={[-5, 0, -6]} scale={0.9} seed={4} />
        <Painting position={[-5.85, 1.7, 2]} rotation={[0, Math.PI / 2, 0]} color="#7c2d12" />
        <Painting position={[-5.85, 1.7, -2]} rotation={[0, Math.PI / 2, 0]} color="#1e3a8a" />
        <Curtains position={[0, 1.4, -7.85]} width={11} />
      </Floor>

      <Floor yOffset={-5} index={2} scrollRef={scrollRef}>
        <Rug position={[0, 0, 0.5]} size={[4, 5]} color="#475569" />
        <PremiumBed position={[0, 0, -0.5]} />
        <FloorLamp position={[-4, 0, 4]} />
        <Monstera position={[5, 0, 5]} scale={1} seed={17} />
        <Painting position={[5.85, 1.7, 0]} rotation={[0, -Math.PI / 2, 0]} color="#0f766e" />
        <Curtains position={[0, 1.4, -7.85]} width={11} />
      </Floor>

      <Floor yOffset={-1} index={3} scrollRef={scrollRef} isPenthouse>
        <Suspense fallback={null}>
          <GLBModel url="/models/tree_palm_1.glb" position={[-5, 0, -6]} scale={0.22} />
          <GLBModel url="/models/tree_palm_2.glb" position={[5, 0, -6.5]} scale={0.24} />
          <GLBModel url="/models/tree_palm_1.glb" position={[-4.5, 0, 6]} scale={0.2} rotation={[0, 1.2, 0]} />
          <GLBModel url="/models/tree_palm_2.glb" position={[4.5, 0, 6.5]} scale={0.22} rotation={[0, -0.8, 0]} />
        </Suspense>
      </Floor>

      {/* {!isLite && (
        <EffectComposer multisampling={0} disableNormalPass>
          <N8AO aoRadius={0.7} intensity={0.7} distanceFalloff={1} />
          <Bloom luminanceThreshold={2.0} luminanceSmoothing={0.4} intensity={0.08} levels={3} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette eskil={false} offset={0.22} darkness={0.4} />
        </EffectComposer>
      )} */}
    </Canvas>
  );
}
