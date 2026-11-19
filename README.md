# CoCheck site

Static site for https://cocheck.ai. No dependencies, no tracking, no third-party assets.

## Add an essay

Create `essays-src/<slug>.md` (lowercase letters, digits, hyphens) with front matter, then build:

```
---
title: Your title
date: 2026-01-31
summary: Optional one-line summary shown on the index.
---

Body in Markdown: headings, paragraphs, emphasis, links, lists, blockquotes, inline code, code blocks.
```

`essays-src/example.md` is a placeholder; delete it when real essays exist.

## Build

```
node build.mjs
```

Needs Node 22, no packages. Writes `docs/` (pages, `CNAME`, `.nojekyll`). Commit `docs/` too.

## Preview

```
python3 -m http.server -d docs
```

## Deploy

- GitHub Pages serves from branch `main`, folder `/docs`, under the org `cocheck-ai`.
- Custom domain `cocheck.ai` (set by `docs/CNAME`).
- DNS at the registrar: A records for the apex to 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153; a `www` CNAME to `cocheck-ai.github.io`.
