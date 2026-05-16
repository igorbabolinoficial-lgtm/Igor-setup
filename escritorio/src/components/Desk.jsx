export default function Desk({ position = [0, 0, 0], color = '#22d3ee' }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2, 0.2, 1]} />
        <meshStandardMaterial color="#8b5a2b" />
      </mesh>

      <mesh position={[-0.85, 0.05, -0.4]} castShadow>
        <boxGeometry args={[0.15, 1, 0.15]} />
        <meshStandardMaterial color="#3b2a1a" />
      </mesh>
      <mesh position={[0.85, 0.05, -0.4]} castShadow>
        <boxGeometry args={[0.15, 1, 0.15]} />
        <meshStandardMaterial color="#3b2a1a" />
      </mesh>
      <mesh position={[-0.85, 0.05, 0.4]} castShadow>
        <boxGeometry args={[0.15, 1, 0.15]} />
        <meshStandardMaterial color="#3b2a1a" />
      </mesh>
      <mesh position={[0.85, 0.05, 0.4]} castShadow>
        <boxGeometry args={[0.15, 1, 0.15]} />
        <meshStandardMaterial color="#3b2a1a" />
      </mesh>

      <mesh position={[0, 1.2, -0.25]} castShadow>
        <boxGeometry args={[1, 0.6, 0.1]} />
        <meshStandardMaterial color="#0b0b0b" emissive={color} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, 0.75, -0.25]} castShadow>
        <boxGeometry args={[0.2, 0.3, 0.1]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
    </group>
  );
}
