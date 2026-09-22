# GPT Midea · Image Vault

Um pequeno site para guardar imagens fora do upload direto do ChatGPT e expô-las por HTTP e MCP.

## O que já existe

- Painel web em `/`
- Upload protegido por `UPLOAD_TOKEN`
- IDs estáveis: `001`, `002`, `003`…
- Imagem direta: `/image/001`
- Página de visualização: `/i/001`
- Lista JSON: `/api/images`
- MCP em `/mcp`
- Ferramentas MCP:
  - `list_images`
  - `get_image`
  - `get_image_url`

O `get_image` devolve o conteúdo da própria imagem como bloco MCP `image`, em base64 e com o `mimeType` correto, para que um cliente MCP compatível receba os pixels diretamente.

## Arranque local

Requisitos: Node.js 20+.

```bash
cp .env.example .env
npm install
npm run check
npm start
```

Abrir `http://localhost:3000`.

## Produção

Define pelo menos:

- `PORT`
- `DATA_DIR`
- `UPLOAD_TOKEN`
- `MCP_TOKEN`
- `PUBLIC_BASE_URL`

Usa um volume persistente para `DATA_DIR`. O código foi feito para poder ser colocado num container/VM e depois ligado a um domínio.

## MCP

Endpoint:

`POST/GET /mcp`

Com `MCP_TOKEN`, o cliente deve enviar:

`Authorization: Bearer <MCP_TOKEN>`

Sem `MCP_TOKEN`, o endpoint fica sem autenticação e deve ser usado apenas para testes locais ou atrás de outra camada de autenticação.

## Próxima fase

A evolução natural é trocar o armazenamento local por S3-compatible/object storage (ou armazenamento da própria cloud), mantendo os IDs e as rotas MCP. Isso permite separar o ciclo de vida das imagens do filesystem do servidor.
