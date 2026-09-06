# Plano: Plugin Nuvio "SushiAnimes"

## 1. Objetivo

Criar um **provider/plugin para Nuvio** (app de streaming) que raspa o site **sushianimes.com.br** e devolve streams de animes resolvidos a partir de `tmdbId + season + episode`.

**Não hospeda conteúdo.** Apenas indexa e resolve links públicos.

---

## 2. Arquitetura Nuvio — pontos-chave

- Plugins são **JS puro** rodados no runtime **QuickJS** (não Node completo).
- Entrada fixa: `getStreams(tmdbId, mediaType, season, episode) → Stream[]`.
- Repositório é uma **pasta de arquivos estáticos** servida via URL (GitHub raw/gh-pages funciona).
- App carrega `manifest.json` → lista providers → usuário habilita.
- Players (ExoPlayer no Android, AVPlayer no iOS) **só aceitam links diretos** (`.m3u8` / `.mp4`). Iframe/HTML não toca.
- Libs permitidas: `cheerio-without-node-native`, `fetch` nativo. **Sem `Buffer`, sem módulos nativos Node.**

---

## 3. Estrutura final do projeto

```
~/www/nuvio-plugin/
├── README.md                       # instruções de instalação
├── package.json                    # deps + scripts
├── package-lock.json
├── manifest.json                   # registro dos providers do repo
├── build.js                        # esbuild bundler
├── server.js                       # dev server local (hot reload)
├── test_providers.js               # teste manual de providers
├── .gitignore
├── providers/                      # saída do build (commitada)
│   └── sushianimes.js              # bundle minificado pronto pro Nuvio
└── src/
    ├── utils/                      # código compartilhado
    │   ├── resolvers.js            # resolveStream() — VidMoly, Voe, Sibnet, etc.
    │   ├── metadata.js             # getTmdbTitles() — busca títulos via TMDB API
    │   ├── http.js                 # fetchText/fetchJson com headers anti-bot
    │   ├── cache.js                # cache em memória + TTL
    │   ├── dle-extractor.js        # helpers pra sites WordPress/DLE
    │   └── logger.js
    └── sushianimes/
        ├── index.js                # entry point (1 linha útil)
        ├── extractor.js            # scrape principal
        └── http.js                 # helpers HTTP específicos do site
```

---

## 4. Dependências (package.json)

```json
{
  "scripts": {
    "build": "node build.js",
    "build:watch": "node build.js --watch",
    "test": "node test_providers.js",
    "dev": "node server.js"
  },
  "dependencies": {
    "cheerio-without-node-native": "^0.1.0"
  },
  "devDependencies": {
    "esbuild": "^0.24.0"
  }
}
```

Tudo **client-side** — sem Express, sem frameworks pesados. Esbuild para bundle; o resto é fetch nativo.

---

## 5. Etapas de implementação

### ETAPA 1 — Bootstrap do projeto
- [ ] Copiar esqueleto de `Gowaru/gowaru-nuvio-providers` (estrutura `src/`, `utils/`, `manifest.json`, `build.js`).
- [ ] Ajustar `package.json` (nome, autor, scripts).
- [ ] Adaptar `build.js` para incluir o novo provider `sushianimes`.
- [ ] Adaptar `manifest.json` com metadata do provider.

### ETAPA 2 — Inspeção do site sushianimes.com.br
**Objetivo:** mapear seletores HTML e URL patterns. Fazer manualmente no navegador + DevTools.

- [ ] **Homepage** (`/`): tem listagem? Carrossel? Mais vistos? Categorias?
- [ ] **Página de busca** (`/?s=...`): formato dos resultados, classes CSS dos cards.
- [ ] **Página do anime** (`/anime/monster-blu-ray-958-1-season-1-episode`):
  - Slug pattern: `monster-blu-ray-958`? ou usa TMDB ID?
  - Como lista episódios? Por temporada?
  - Como separa dublado/legendado?
- [ ] **Página do episódio**: qual player usa? Iframe? Múltiplos hosts? Variável JS com token?
- [ ] **Anti-bot**: Cloudflare? CAPTCHA? Cookie obrigatório?

**Ferramenta:** `curl -A "Mozilla/..." -i https://sushianimes.com.br/` e DevTools (Network tab).

### ETAPA 3 — Implementação do `extractor.js`
Baseado no padrão do `voiranime` (anime francês com player similar), adaptar para:

1. **`getTmdbTitles(tmdbId, season)`** → busca títulos no TMDB.
2. **`slugProbe(titles, season)`** → testa variantes de slug em paralelo (`monster`, `monster-blu-ray`, `monster-dub`, etc.).
3. **`searchSite(query)`** → fallback: raspa `/anime/?s=...` ou `/search?q=...`.
4. **`findEpisodeUrl(animePage, targetEp, season)`** → encontra URL do episódio.
5. **`resolveStreams(episodeUrl)`** → extrai iframe/hosts e chama `resolveStream()` de `utils/resolvers.js` para cada um.
6. **`extractStreams(tmdbId, mediaType, season, episode)`** → orquestra tudo acima. **Entry point** exportado.

### ETAPA 4 — Hosts brasileiros comuns
Adicionar/atualizar resolvers em `utils/resolvers.js` para hosts que o SushiAnimes costuma usar:

- `vidmoly.net` (muito comum)
- `voe.sx`
- `streamtape.com`
- `uqload.com`
- `filemoon.sx`
- `mixdrop.co`
- `doodstream.com`
- `sibnet.ru` (se aparecer)

Cada um com padrão próprio: geralmente é `GET` na página do embed, extrair `<source src="...">` ou variável JS obfuscada.

### ETAPA 5 — Configuração do `manifest.json`

```json
{
  "name": "Nuvio SushiAnimes",
  "version": "1.0.0",
  "scrapers": [
    {
      "id": "sushianimes",
      "name": "SushiAnimes",
      "description": "Animes dublados/legendados do sushianimes.com.br",
      "version": "1.0.0",
      "author": "seu-user",
      "supportedTypes": ["movie", "tv"],
      "filename": "providers/sushianimes.js",
      "enabled": true,
      "logo": "https://sushianimes.com.br/favicon.ico",
      "contentLanguage": ["pt-BR"],
      "formats": ["mp4", "m3u8"],
      "limited": false,
      "disabledPlatforms": [],
      "supportsExternalPlayer": false
    }
  ]
}
```

### ETAPA 6 — Build e teste
- [ ] `npm install` → instala esbuild + cheerio.
- [ ] `npm run build` → gera `providers/sushianimes.js` minificado.
- [ ] `node test_providers.js sushianimes <tmdbId> tv <season> <episode>` → testa offline.
- [ ] Validar retorno: array com `name`, `title`, `quality`, `url` (m3u8/mp4 direto), `headers`, `isDirect: true`.

### ETAPA 7 — Publicação e instalação
- [ ] Subir repo no GitHub.
- [ ] Apontar branch `main` na URL raw: `https://raw.githubusercontent.com/<user>/nuvio-plugin/main/`.
- [ ] No app Nuvio: **Settings → Content & Discovery → Plugins → Add Repository** → colar URL.
- [ ] Refresh, habilitar **SushiAnimes**.
- [ ] Testar com anime conhecido (ex: Monster, Naruto, One Piece).

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Site muda layout/HTML | Versionar manifest.json, manter logs, fallback selectors |
| Anti-bot agressivo (Cloudflare) | Usar `fetchText`/`fetchJson` com UA correto; se necessário, contornar via cookie/sessão |
| Player obfusca link em JS | Reescrever decoder específico (vide padrão `aesdecryptor` no Gowaru) |
| Hosts de embed caem (VidMoly off, etc.) | Manter lista de resolvers atualizada, testar periodicamente |
| QuickJS não suporta algo | Evitar `Buffer`, `__dirname`, `require` — só ES modules e `fetch` |
| CORS no browser (dev) | Usar `server.js` com proxy local durante desenvolvimento |

---

## 7. Estimativa de complexidade

- **Setup (etapas 1, 5, 7):** ~30min — copy/paste de template.
- **Inspeção do site (etapa 2):** ~1-2h — depende da robustez do anti-bot.
- **Extractor (etapas 3, 4):** ~3-6h — coração do trabalho.
- **Testes + iteração (etapa 6):** ~2-4h — exige ajustes finos em seletores e timing.
- **Total:** ~1-2 dias para versão funcional mínima (MVP).

---

## 8. Referências

- **Template base:** https://github.com/Gowaru/gowaru-nuvio-providers
  - `src/voiranime/` → melhor exemplo de provider de anime
  - `src/utils/resolvers.js` → biblioteca de resolvers
  - `DOCUMENTATION.md` → doc oficial do template
  - `ANIME_SYNC_GUIDE.md` → guia de mapping TMDB ↔ site
- **Outro exemplo:** https://github.com/itsmeadarsh2008/Streamline
- **Site alvo:** https://sushianimes.com.br

---

## 9. Próximos passos imediatos

1. Fork/clone do Gowaru repo para `~/www/nuvio-plugin/`:
   ```bash
   git clone https://github.com/Gowaru/gowaru-nuvio-providers.git ~/www/nuvio-plugin
   cd ~/www/nuvio-plugin
   git remote rename origin upstream
   ```
2. Limpar providers que não interessam; manter `utils/` intacto.
3. Inspeção manual do sushianimes.com.br no navegador.
4. Implementar `src/sushianimes/` baseado nos achados.
5. Build, teste local, publicação.
