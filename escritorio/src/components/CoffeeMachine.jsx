export default function CoffeeMachine({ position = [0, 0, 0] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.8, 0.9]} />
        <meshStandardMaterial color="#2d1b0e" />
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.8, 0.6, 0.8]} />
        <meshStandardMaterial color="#7b3f00" />
      </mesh>
      <mesh position={[0, 0.85, 0.45]} castShadow>
        <boxGeometry args={[0.2, 0.2, 0.1]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      <mesh position={[0, 0.05, 0.55]} castShadow>
        <boxGeometry args={[0.25, 0.3, 0.25]} />
        <meshStandardMaterial color="#f5f5f5" />
      </mesh>
      <mesh position={[0.3, 1.15, 0.41]} castShadow>
        <boxGeometry args={[0.08, 0.08, 0.02]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1} />
      </mesh>
    </group>
  );
}
