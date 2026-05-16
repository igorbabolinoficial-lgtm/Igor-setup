/**
 * Area de descompressão em volta da cafeteira: tapete, banco baixo, mesinha e planta.
 * `center` deve coincidir com a posição da CoffeeMachine no OfficeArena.
 */
export default function AreaCafe({ center = [-7, 0, -6] }) {
  const [cx, , cz] = center;

  return (
    <group>
      <mesh position={[cx + 1, 0.01, cz + 1]} receiveShadow>
        <boxGeometry args={[5, 0.02, 5]} />
        <meshStandardMaterial color="#5b2e2a" />
      </mesh>
      <mesh position={[cx + 1, 0.025, cz + 1]} receiveShadow>
        <boxGeometry args={[4.6, 0.02, 4.6]} />
        <meshStandardMaterial color="#7a3f3a" />
      </mesh>

      <mesh position={[cx + 2.5, 0.35, cz]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.3, 2.2]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh position={[cx + 2.9, 0.75, cz]} castShadow>
        <boxGeometry args={[0.2, 0.8, 2.2]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      <mesh position={[cx + 2.45, 0.55, cz - 0.6]} castShadow>
        <boxGeometry args={[0.6, 0.2, 0.7]} />
        <meshStandardMaterial color="#a855f7" />
      </mesh>
      <mesh position={[cx + 2.45, 0.55, cz + 0.6]} castShadow>
        <boxGeometry args={[0.6, 0.2, 0.7]} />
        <meshStandardMaterial color="#22d3ee" />
      </mesh>

      <mesh position={[cx + 1.6, 0.25, cz]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.1, 1.4]} />
        <meshStandardMaterial color="#8b5a2b" />
      </mesh>
      <mesh position={[cx + 1.6, 0.1, cz - 0.6]} castShadow>
        <boxGeometry args={[0.08, 0.2, 0.08]} />
        <meshStandardMaterial color="#3b2a1a" />
      </mesh>
      <mesh position={[cx + 1.6, 0.1, cz + 0.6]} castShadow>
        <boxGeometry args={[0.08, 0.2, 0.08]} />
        <meshStandardMaterial color="#3b2a1a" />
      </mesh>
      <mesh position={[cx + 1.6, 0.32, cz + 0.3]} castShadow>
        <boxGeometry args={[0.4, 0.02, 0.3]} />
        <meshStandardMaterial color="#f5f5f5" />
      </mesh>

      <mesh position={[cx - 1.2, 0.3, cz - 1.4]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.6, 0.7]} />
        <meshStandardMaterial color="#5b2e2a" />
      </mesh>
      <mesh position={[cx - 1.2, 0.85, cz - 1.4]} castShadow>
        <boxGeometry args={[0.15, 0.5, 0.15]} />
        <meshStandardMaterial color="#3b2a1a" />
      </mesh>
      <mesh position={[cx - 1.2, 1.35, cz - 1.4]} castShadow>
        <boxGeometry args={[0.9, 0.7, 0.9]} />
        <meshStandardMaterial color="#2a4a2a" />
      </mesh>
      <mesh position={[cx - 1.4, 1.7, cz - 1.2]} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.6]} />
        <meshStandardMaterial color="#3a5a3a" />
      </mesh>
      <mesh position={[cx - 1, 1.9, cz - 1.6]} castShadow>
        <boxGeometry args={[0.5, 0.4, 0.5]} />
        <meshStandardMaterial color="#4a6a4a" />
      </mesh>

      <mesh position={[cx + 0.9, 0.3, cz - 0.7]} castShadow>
        <boxGeometry args={[0.4, 0.6, 0.4]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
    </group>
  );
}
