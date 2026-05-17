# Modelos GLB

Coloque aqui arquivos `.glb` (CC0, formato comprimido do glTF). Quando estiverem aqui, eu pluga via `useGLTF` do drei com fallback automático: se o arquivo não existir ou der erro, a versão procedural atual continua funcionando.

## Onde baixar (todos CC0, sem login)

### Árvores e plantas

- **Poly Pizza** → https://poly.pizza/ → pesquise:
  - `palm tree` (palmeira pro rooftop)
  - `pine tree` ou `coniferous tree` (pinheiro pra fundo)
  - `oak tree` ou `tree` (mata atlântica genérica)
  - Clique no resultado, **Download** → escolha **GLB**

- **Kenney Nature Kit** → https://kenney.nl/assets/nature-kit → ZIP completo com 200+ modelos. Os GLB ficam em `Models/GLB format/`.

### Casas / vilarejo

- **Poly Pizza** → pesquise: `beach house`, `small house`, `cottage`, `simple house`

## Nomes de arquivo esperados

Quando me mandar, eu adapto pro nome real. Mas se quiser deixar pronto:

- `tree_palm.glb` — palmeira (rooftop + entorno)
- `tree_pine.glb` — pinheiro/coníferas (fundo)
- `tree_oak.glb` — árvore folhosa (mata)
- `house_small.glb` — casinha do vilarejo

## Tamanho recomendado

Cada arquivo idealmente abaixo de **500 KB**. GLBs muito pesados (>2 MB cada) vão tornar o load lento. Modelos low-poly de Poly Pizza/Kenney costumam ser leves.

## Quando colar os arquivos

1. Joga 1+ arquivo nesta pasta.
2. Me avisa qual arquivo veio (nome real ou renomeado).
3. Eu adapto o código pra carregar com `useGLTF` envolto em `Suspense + ErrorBoundary` — se falhar, fallback procedural automático.
