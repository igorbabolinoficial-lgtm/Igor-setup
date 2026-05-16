/**
 * Cadeira voxel — base com 4 pés, assento e encosto.
 * Topo do assento fica em y=0.55 (alinha com agente seated no VoxelAgent: hip em y=0.55).
 */
export default function Chair({ position = [0, 0, 0], color = '#1f2937' }) {
  return (
    <group position={position}>
      <mesh position={[-0.25, 0.2, -0.25]} castShadow>
        <boxGeometry args={[0.1, 0.4, 0.1]} />
        <meshStandardMaterial color="#0b0b0b" />
      </mesh>
      <mesh position={[0.25, 0.2, -0.25]} castShadow>
        <boxGeometry args={[0.1, 0.4, 0.1]} />
        <meshStandardMaterial color="#0b0b0b" />
      </mesh>
      <mesh position={[-0.25, 0.2, 0.25]} castShadow>
        <boxGeometry args={[0.1, 0.4, 0.1]} />
        <meshStandardMaterial color="#0b0b0b" />
      </mesh>
      <mesh position={[0.25, 0.2, 0.25]} castShadow>
        <boxGeometry args={[0.1, 0.4, 0.1]} />
        <meshStandardMaterial color="#0b0b0b" />
      </mesh>

      <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.75, 0.12, 0.7]} />
        <meshStandardMaterial color={color} />
      </mesh>

      <mesh position={[0, 0.95, 0.32]} castShadow>
        <boxGeometry args={[0.75, 0.85, 0.12]} />
        <meshStandardMaterial color={color} />
      </mesh>

      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.68, 0.04, 0.62]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
    </group>
  );
}
