---
title: Configuration & API
description: The Storelight config file, commit settings, and local HTTP API.
---

## `storelight.config.json`

The file lives next to `package.json`.

```json
{
  "roots": [
    {
      "id": "demo",
      "label": "Demo docs",
      "path": "./content/demo",
      "include": ["**/*.md"],
      "exclude": ["node_modules/**", ".git/**", "drafts/**"]
    },
    {
      "id": "handbook",
      "label": "Team handbook",
      "path": "~/notes/handbook",
      "include": ["**/*.md"],
      "exclude": ["private/**"]
    }
  ],
  "git": {
    "autoCommit": true,
    "debounceMs": 2500,
    "commitPrefix": "docs(storelight)"
  },
  "editor": {
    "autosaveMs": 900
  }
}
```

| Field | Meaning |
| --- | --- |
| `roots[].path` | Absolute, relative to the config file, or `~/…`. |
| `roots[].include` | Fast-glob patterns, relative to the root. |
| `roots[].exclude` | Fast-glob ignore patterns. Built-in excludes always apply (`node_modules`, `.git`, `dist`, `.astro`). |
| `git.autoCommit` | Set to `false` to write files without committing. |
| `git.debounceMs` | Idle time before a queued Studio save is committed. |
| `git.commitPrefix` | Subject prefix. The action and repo-relative path are appended. |
| `editor.autosaveMs` | Studio autosave idle delay. |

Root ids must be unique and match `[a-zA-Z0-9][a-zA-Z0-9_-]*`.

## Auto-commit details

- Only the edited file is staged and committed. Other changes in the repository are untouched.
- A commit is skipped when there is no diff.
- Ignored files and files outside a git repository produce a visible save result without a commit.
- Git hooks run normally. If a hook rewrites the file, the committed content is the result on disk.
- No push is performed.

## Local API

All endpoints are same-origin JSON endpoints and set `Cache-Control: no-store`. Mutating requests from a cross-site `Origin` are rejected.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/tree` | GET | Roots, files, nested tree, editor settings. |
| `/api/doc?root&path` | GET | Raw source, hash, split frontmatter. |
| `/api/doc` | PUT | Save content (`baseHash`, `action`, optional `flush`). |
| `/api/toggle-task` | POST | Toggle a task marker at a source offset. |
| `/api/edit-block` | POST | Replace a source range. |
| `/api/asset?root&path` | GET | Serve images and other files from a content root. |
| `/api/history?root&path` | GET | Recent commits for a file; add `&hash=` for a diff. |
| `/api/settings` | GET/PUT | Read or write `storelight.config.json`. |

## Security posture

This is an authoring tool for **localhost**, not a hosted CMS:

- The dev server and production server bind to `127.0.0.1` by default.
- Any file inside a configured root can be written by the app. Don't point a root at a directory you don't want exposed.
- There is no authentication. If you need LAN access, put it behind a trusted proxy and be deliberate about the risk.
- Raw HTML in Markdown is rendered. Only point Storelight at content you trust.

## Markdown rendering

The browse view renders with `remark-parse`, `remark-gfm`, `remark-math`, `rehype-raw`,
`rehype-katex`, `rehype-mermaid` (custom wrapper), and Shiki. Supported:

| Syntax | Notes |
| --- | --- |
| GFM tables, task lists, footnotes, strikethrough, autolinks | via `remark-gfm` |
| Inline math `$…$` | KaTeX |
| Display math `$$…$$` | KaTeX, wrapped for inline editing |
| Mermaid ` ```mermaid ` fences | rendered client-side with theme-aware colours |
| Code fences | Shiki, dual light/dark themes |
| Raw HTML | passed through |
| Relative images and `.md` links | rewritten to `/api/asset` and `/browse/...` |

The Studio's visual mode uses Crepe's built-in KaTeX support. Mermaid code blocks have a preview
toggle in the code block toolbar.

## Scripts

```bash
pnpm dev       # author locally
pnpm build     # static Starlight + Node server for on-demand routes
pnpm serve     # run the built server on 127.0.0.1:4321
pnpm check     # Astro + TypeScript checks
```
