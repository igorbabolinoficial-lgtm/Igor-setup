/**
 * OfficeArena — renderiza /escritorio/escritorio.html (Three.js vanilla portado do L2)
 * via iframe. Toda lógica visual está no HTML standalone que faz fetch direto
 * de /api/agentes/status (mesma origem).
 *
 * Os componentes filhos (Floor.jsx, Chair.jsx, Desk.jsx, VoxelAgent.jsx, etc)
 * ficaram obsoletos — removíveis numa próxima limpeza.
 */
export default function OfficeArena() {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: 'calc(100vh - 80px)',
      minHeight: 480,
      borderRadius: 12,
      overflow: 'hidden',
      border: '1px solid #1F1F26',
      background: '#0A0A0E',
    }}>
      <iframe
        src="/escritorio/escritorio.html"
        title="Escritório Igor — Sala OSIA"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
        }}
        allow="fullscreen"
      />
    </div>
  );
}
