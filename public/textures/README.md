# Texturas fotográficas

Baixe os 3 arquivos JPG abaixo (todos CC0, Poly Haven) e coloque nesta pasta com os **nomes exatos**.

## Arquivos esperados (3)

| Nome exato | Onde baixar |
|---|---|
| `grass_diff.jpg` | https://polyhaven.com/a/aerial_grass_rock → botão **Download** roxo → escolha **JPG · 2K** → coluna **Diffuse** |
| `grass_nor.jpg` | mesma página → **JPG · 2K** → coluna **Normal** (GL) |
| `sand_diff.jpg` | https://polyhaven.com/a/aerial_beach_03 → **JPG · 2K** → coluna **Diffuse** |

> O arquivo vem com nome tipo `aerial_grass_rock_diff_2k.jpg` — renomeie pro nome curto da tabela (`grass_diff.jpg`).

## Como ativar

A flag `USE_REAL_TEXTURES = true` já está ligada em `src/Showcase3D.jsx`. Basta:

1. Confirmar que os arquivos estão nesta pasta.
2. Salvar (Vite recarrega automático).

**Se algum arquivo faltar, o site não quebra** — o `TextureBoundary` cai pra versão procedural (canvas) que já funciona.

## Sobre a água

Não precisa de arquivo. A água usa uma **normal map procedural gerada via canvas** (`PROCEDURAL_WATER_NORMAL` em `Showcase3D.jsx`), que dá a ondulação fina sem depender de download externo.
