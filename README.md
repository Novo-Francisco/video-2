# Gerador de Vídeo com Fotos (Cloudflare + Replicate)

Este projeto permite:

- Enviar várias fotos
- Transformar cada foto em uma cena animada (IA)
- Juntar todas as cenas em um vídeo final

## Deploy no Cloudflare Pages

1. Suba este projeto no GitHub
2. Vá no Cloudflare → Pages → Create Project
3. Conecte ao repositório
4. Configure:
   - Build command: none
   - Output directory: public
5. Em Settings → Environment Variables:
   - REPLICATE_API_TOKEN = sua chave

Pronto!
