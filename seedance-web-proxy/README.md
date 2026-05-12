# Seedance Web + Proxy (Windows 7 friendly)

Este projeto foi feito para você usar no **Windows 7** com **vscode.dev**: o site é estático (HTML/JS) e roda no navegador.

## Por que existe um "proxy"?
Algumas documentações de Seedance são explícitas: **não exponha API keys no código do navegador**; use backend/variáveis de ambiente. (Ex.: seedanceapi.ai diz "Keep your API key safe" e "Never expose ... in client-side code".)

## Hospedagem recomendada (sem servidor para você administrar)
- **Netlify**: publica o site estático + "Functions" (serverless) para chamar a API com a chave guardada em variáveis. O próprio Netlify documenta que variáveis de ambiente podem ser usadas por Functions para armazenar valores sensíveis como API keys.

## Configuração no Netlify
1) Faça deploy do repositório no Netlify.
2) Vá em *Site settings → Environment variables*.
3) Crie variáveis (escopo Functions):
   - `SEEDANCE_API_BASE_URL` (ex.: https://seedanceapi.org/v2)
   - `SEEDANCE_API_KEY`

> Nota do Netlify: variáveis em `netlify.toml` não ficam disponíveis para Functions; use a UI/CLI/API do Netlify para declarar env vars para Functions.

## Como usar
- Abra `public/index.html` pelo domínio do Netlify.
- Edite as cenas, coloque a imagem em URL pública (https), e clique em "Gerar".
- O app gera URLs por cena e tenta concatenar no navegador usando FFmpeg WASM.

## Arquivos principais
- `public/index.html` + `public/app.js`
- `netlify/functions/seedance-generate.js`
- `netlify/functions/seedance-status.js`
