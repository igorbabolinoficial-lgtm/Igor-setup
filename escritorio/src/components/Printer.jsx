export default function Printer({ position = [0, 0, 0] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 1, 1]} />
        <meshStandardMaterial color="#4a5568" />
      </mesh>
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[1.2, 0.1, 0.8]} />
        <meshStandardMaterial color="#1a202c" />
      </mesh>
      <mesh position={[0, 0.7, 0.51]} castShadow>
        <boxGeometry args={[0.4, 0.15, 0.02]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0, 0.15, 0.45]} castShadow>
        <boxGeometry args={[1.2, 0.25, 0.15]} />
        <meshStandardMaterial color="#2d3748" />
      </mesh>
    </group>
  );
}
