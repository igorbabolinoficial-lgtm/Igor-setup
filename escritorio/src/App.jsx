import OfficeArena from './components/OfficeArena.jsx';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <header
        style={{
          position: 'absolute',
          top: 12,
          left: 16,
          zIndex: 10,
          padding: '8px 14px',
          background: 'rgba(11, 16, 32, 0.75)',
          border: '1px solid #1f2a44',
          borderRadius: 8,
          fontSize: 13,
          letterSpacing: 0.4,
        }}
      >
        <strong style={{ color: '#7dd3fc' }}>Escritório Igor Babolin</strong>
        <span style={{ opacity: 0.7, marginLeft: 8 }}>
          7 agentes em tempo real
        </span>
      </header>
      <OfficeArena />
    </div>
  );
}
