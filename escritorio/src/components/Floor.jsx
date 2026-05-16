/**
 * Chão de madeira em estilo voxel — tábuas alternadas em dois tons.
 * Cada bloco unitário (1x1) representa uma "tábua" curta.
 */
export default function Floor({ size = 20 }) {
  const tiles = [];
  for (let x = -size / 2; x < size / 2; x++) {
    for (let z = -size / 2; z < size / 2; z++) {
      const ringe = (Math.floor(z) + (Math.floor(x) % 2)) % 2 === 0;
      const cor = ringe ? '#b08a5b' : '#8a6a44';
      tiles.push(
        <mesh
          key={`${x}-${z}`}
          position={[x + 0.5, -0.5, z + 0.5]}
          receiveShadow
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={cor} />
        </mesh>
      );
    }
  }
  return <group>{tiles}</group>;
}
