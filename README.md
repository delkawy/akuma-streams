# Akuma Streams

Coleção de providers para o app **Nuvio**. Hospeda provedores que raspam sites públicos e devolvem streams diretos (`.mp4` / `.m3u8`) compatíveis com o player nativo.

## Providers incluídos

| ID | Site | Formato |
|---|---|---|
| `sushianimes` | [sushianimes.com.br](https://sushianimes.com.br) | `mp4` |

## Estrutura

```
.
├── README.md
├── package.json
├── manifest.json                   # registro dos providers (carregado pelo Nuvio)
├── build.js                        # esbuild bundler
├── providers/                      # saída do build (commitada)
│   └── sushianimes.js              # bundle minificado pronto pro Nuvio
├── src/
│   ├── utils/                      # código compartilhado
│   │   ├── http.js                 # fetchText / fetchJson + headers anti-bot
│   │   ├── cache.js                # cache em memória com TTL
│   │   ├── logger.js               # logger leve (QuickJS-friendly)
│   │   └── metadata.js             # lookup de títulos via TMDB
│   └── sushianimes/
│       ├── index.js                # entry point (getStreams)
│       ├── http.js                 # fetch + cookie de idade + CSRF
│       └── extractor.js            # parse do HTML e do embed
└── test/
    ├── test_extractor.mjs          # 19 testes offline (fixtures)
    └── fixtures/                   # HTML real capturado do site
```

## Setup local

```bash
npm install
npm run build                       # gera providers/sushianimes.js
npm test                            # roda os 19 testes offline
TMDB_API_KEY=sua-chave node test_providers.mjs sushianimes 30981 tv 1 1
```

## Instalação no Nuvio

1. Abra o app Nuvio
2. **Settings → Content & Discovery → Plugins → Add Repository**
3. Cole a URL do `manifest.json` da branch `main`:
   ```
   https://raw.githubusercontent.com/delkawy/akuma-streams/main/manifest.json
   ```
4. Refresh, habilite **SushiAnimes**
5. Abra um anime (ex: Monster S1E1) — o provider deve aparecer como opção de stream

## Como o provider funciona (sushianimes)

```
getStreams(tmdbId, mediaType, season, episode)
  └─ extractStreams()
       ├─ GET /                              → CSRF token (var _TOKEN)
       ├─ getTmdbTitles() → searchAnime()    → TMDB → /search/<title> → slug+id
       ├─ GET /anime/<slug>-<id>-<season>-season-<ep>-episode
       │   → data-embed ids (Dr. Tenma, FullHD, Mobile…)
       └─ para cada player (rankeado por qualidade):
            └─ POST /ajax/embed (CSRF + id)
                 → iframe srcdoc → var playerEmbed → URL .mp4 direta
```

## Limitações conhecidas

- **Cloudflare Bot Management**: o site detecta clientes fora de browsers reais. Em Node `fetch` puro, o `/ajax/embed` retorna 503 (`{"success":false,"retryable":true}`). Em WebView (Android/iOS) o provider deve funcionar porque o fingerprint é de browser real.
- **Cookie de idade**: o site exige clique no diálogo "Tenho 18 ou mais" na primeira visita. O provider envia `Cookie: sushi_age_verified=1` mas isso pode não ser suficiente em ambientes anti-bot rigorosos.
- **Teste ao vivo**: requer um browser real (Chromium/WebKit) ou cookies de sessão válidos.

## Variáveis de ambiente (teste)

- `TMDB_API_KEY` — chave da API v3 do TMDB. Sem ela, o teste usa fallback mínimo (busca genérica).
