const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const PROVIDERS = [
  {
    id: 'sushianimes',
    entry: 'src/sushianimes/index.js',
    outfile: 'providers/sushianimes.js',
  },
];

const watch = process.argv.includes('--watch');
const minify = !watch;

async function build() {
  for (const p of PROVIDERS) {
    const entry = path.resolve(p.entry);
    const outfile = path.resolve(p.outfile);
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      outfile,
      platform: 'browser',
      format: 'iife',
      target: ['es2020'],
      minify,
      legalComments: 'none',
      logLevel: 'info',
      // QuickJS não tem 'node:*' nativo; nada de require dinâmico.
      banner: { js: '"use strict";' },
    });
    console.log(`[build] ${p.id} → ${p.outfile}`);
  }
}

if (watch) {
  (async () => {
    const ctxs = [];
    for (const p of PROVIDERS) {
      const ctx = await esbuild.context({
        entryPoints: [path.resolve(p.entry)],
        bundle: true,
        outfile: path.resolve(p.outfile),
        platform: 'browser',
        format: 'iife',
        target: ['es2020'],
        logLevel: 'info',
      });
      await ctx.watch();
      ctxs.push(ctx);
      console.log(`[watch] ${p.id}`);
    }
  })();
} else {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
