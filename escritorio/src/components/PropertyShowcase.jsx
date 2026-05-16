import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useScroll, ScrollControls, Scroll, Html, Environment, ContactShadows, Float, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';

// --- COMPONENTES DE MOBILIÁRIO REALISTA (PROCEDURAL) ---

function RealisticSofa({ position }) {
  return (
    <group position={position}>
      {/* Base/Pés */}
      <mesh position={[-1, 0.05, 0.35]}><boxGeometry args={[0.1, 0.1, 0.1]} /><meshStandardMaterial color="#000" /></mesh>
      <mesh position={[1, 0.05, 0.35]}><boxGeometry args={[0.1, 0.1, 0.1]} /><meshStandardMaterial color="#000" /></mesh>
      <mesh position={[-1, 0.05, -0.35]}><boxGeometry args={[0.1, 0.1, 0.1]} /><meshStandardMaterial color="#000" /></mesh>
      <mesh position={[1, 0.05, -0.35]}><boxGeometry args={[0.1, 0.1, 0.1]} /><meshStandardMaterial color="#000" /></mesh>
      
      {/* Assento Principal */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[2.4, 0.4, 1]} />
        <meshStandardMaterial color="#334155" roughness={0.8} />
      </mesh>
      
      {/* Almofadas do Encosto */}
      <mesh position={[-0.6, 0.7, -0.4]} rotation={[-0.2, 0, 0]} castShadow>
        <boxGeometry args={[1.1, 0.6, 0.2]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
      <mesh position={[0.6, 0.7, -0.4]} rotation={[-0.2, 0, 0]} castShadow>
        <boxGeometry args={[1.1, 0.6, 0.2]} />
        <meshStandardMaterial color="#475569" />
      </mesh>
      
      {/* Braços */}
      <mesh position={[-1.25, 0.45, 0]} castShadow><boxGeometry args={[0.2, 0.7, 1]} /><meshStandardMaterial color="#1e293b" /></mesh>
      <mesh position={[1.25, 0.45, 0]} castShadow><boxGeometry args={[0.2, 0.7, 1]} /><meshStandardMaterial color="#1e293b" /></mesh>
    </group>
  );
}

function RealisticBed({ position }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.1, 0]}><boxGeometry args={[1.8, 0.2, 2.4]} /><meshStandardMaterial color="#0f172a" /></mesh>
      <mesh position={[0, 0.4, 0]} castShadow><boxGeometry args={[1.7, 0.4, 2.3]} /><meshStandardMaterial color="#f8fafc" roughness={1} /></mesh>
      <mesh position={[0, 0.8, -1.15]} castShadow><boxGeometry args={[1.8, 1.2, 0.1]} /><meshStandardMaterial color="#1e293b" /></mesh>
      {/* Travesseiros */}
      <mesh position={[-0.4, 0.65, -0.8]} rotation={[-0.4, 0, 0]} castShadow><boxGeometry args={[0.6, 0.15, 0.4]} /><meshStandardMaterial color="#e2e8f0" /></mesh>
      <mesh position={[0.4, 0.65, -0.8]} rotation={[-0.4, 0, 0]} castShadow><boxGeometry args={[0.6, 0.15, 0.4]} /><meshStandardMaterial color="#e2e8f0" /></mesh>
    </group>
  );
}

function RealisticDining({ position }) {
  return (
    <group position={position}>
      {/* Mesa */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[2.5, 0.05, 1.2]} />
        <meshPhysicalMaterial color="#ffffff" transmission={0.9} thickness={0.1} transparent opacity={0.5} />
      </mesh>
      <mesh position={[-1.1, 0.37, 0]}><boxGeometry args={[0.05, 0.75, 1]} /><meshStandardMaterial color="#1e293b" /></mesh>
      <mesh position={[1.1, 0.37, 0]}><boxGeometry args={[0.05, 0.75, 1]} /><meshStandardMaterial color="#1e293b" /></mesh>
      
      {/* Cadeiras */}
      <mesh position={[0, 0.4, 0.9]} castShadow><boxGeometry args={[0.5, 0.05, 0.5]} /><meshStandardMaterial color="#000" /></mesh>
      <mesh position={[0, 0.7, 1.1]} castShadow><boxGeometry args={[0.5, 0.6, 0.05]} /><meshStandardMaterial color="#000" /></mesh>
    </group>
  );
}

function ApartmentLayer({ children, yOffset = 0, title, description, isPenthouse = false }) {
  const group = useRef();
  const scroll = useScroll();

  useFrame((state) => {
    const scrollOffset = scroll.offset;
    group.current.position.y = yOffset + (scrollOffset * 22);
    group.current.rotation.y = scrollOffset * 0.4;
  });

  return (
    <group ref={group}>
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[14, 0.15, 20]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      
      {/* Vigas de Madeira Decorativas (Imagem 2) */}
      <mesh position={[-6.9, 1.5, 0]} castShadow><boxGeometry args={[0.2, 3, 20]} /><meshStandardMaterial color="#451a03" /></mesh>
      <mesh position={[6.9, 1.5, 0]} castShadow><boxGeometry args={[0.2, 3, 20]} /><meshStandardMaterial color="#451a03" /></mesh>
      
      {/* Vidros de Fachada */}
      <mesh position={[0, 1.5, 9.9]} transparent opacity={0.2}>
        <boxGeometry args={[13.8, 3, 0.05]} />
        <meshPhysicalMaterial color="#ffffff" transmission={1} thickness={0.5} transparent opacity={0.2} />
      </mesh>

      {children}

      <Html position={[10, 2, 0]} distanceFactor={15}>
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.95)', color: '#000', padding: '20px 30px', 
          borderRadius: '4px', whiteSpace: 'nowrap', pointerEvents: 'none',
          borderLeft: '8px solid #fbbf24',
          boxShadow: '30px 30px 80px rgba(0,0,0,0.15)',
          fontFamily: 'Inter, sans-serif'
        }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', opacity: 0.4, letterSpacing: '3px' }}>LUXURY ASSET</div>
          <div style={{ fontSize: '28px', fontWeight: '900', marginTop: '5px', letterSpacing: '-1.5px' }}>{title}</div>
          <div style={{ fontSize: '14px', marginTop: '8px', color: '#475569', fontWeight: '400' }}>{description}</div>
        </div>
      </Html>
    </group>
  );
}

export default function PropertyShowcase() {
  return (
    <div style={{ width: '100%', height: '100vh', background: '#020617' }}>
      <Canvas shadows camera={{ position: [40, 40, 40], fov: 22 }}>
        <color attach="background" args={['#020617']} />
        
        <ambientLight intensity={0.4} />
        <spotLight position={[50, 50, 50]} angle={0.15} penumbra={1} intensity={2.5} castShadow />
        <Environment preset="apartment" />
        
        <ScrollControls pages={5} damping={0.1}>
          <group position={[0, -15, 0]}>
             {/* L1: Living */}
             <ApartmentLayer yOffset={0} title="MASTER LIVING" description="Mobiliário assinado e vista panorâmica.">
                <RealisticSofa position={[-3, 0.1, -2]} />
                <RealisticDining position={[3, 0.1, 4]} />
             </ApartmentLayer>
             
             {/* L2: Suíte */}
             <ApartmentLayer yOffset={7} title="GRAND SUÍTE" description="Conforto absoluto e design minimalista.">
                <RealisticBed position={[0, 0.1, 0]} />
                <mesh position={[-4, 1.2, -8]} castShadow><boxGeometry args={[4, 2.4, 0.2]} /><meshStandardMaterial color="#1e293b" /></mesh>
             </ApartmentLayer>
             
             {/* L3: Piscina */}
             <ApartmentLayer yOffset={14} title="PRIVATE POOL" description="Borda infinita com tecnologia neural." isPenthouse>
                <mesh position={[0, 0.2, 0]} rotation={[-Math.PI/2, 0, 0]}>
                  <planeGeometry args={[10, 10]} />
                  <meshDistortMaterial color="#0ea5e9" speed={2} distort={0.2} radius={1} />
                </mesh>
             </ApartmentLayer>
          </group>

          <Scroll html>
            <div style={{ position: 'absolute', top: '10vh', left: '8vw', color: '#fbbf24', fontFamily: 'Inter, sans-serif' }}>
              <h1 style={{ fontSize: '8rem', fontWeight: 900, lineHeight: 0.8, margin: 0, letterSpacing: '-8px' }}>IGOR<br/>BABOLIN</h1>
              <div style={{ height: '6px', width: '100px', background: '#fbbf24', margin: '40px 0' }} />
              <p style={{ fontSize: '1.4rem', textTransform: 'uppercase', letterSpacing: '8px', fontWeight: 300, color: '#94a3b8' }}>Real Estate High Fidelity</p>
            </div>
          </Scroll>
        </ScrollControls>

        <ContactShadows position={[0, -15, 0]} opacity={0.5} scale={50} blur={2.4} far={15} />
      </Canvas>
    </div>
  );
}
