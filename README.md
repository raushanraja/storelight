# Storelight

A local docs studio built on Astro Starlight.

Point it at one or more folders of Markdown files, browse them with Starlight, edit them in a WYSIWYG editor or directly on the rendered page, and let every save become a focused git commit.

## Quick start

```bash
pnpm install
pnpm dev
```

Then open:

- `http://localhost:4321/` — the Starlight site and guide
- `http://localhost:4321/studio/` — the full-screen editor
- `http://localhost:4321/browse/demo/welcome.md` — a demo doc with inline editing
- `http://localhost:4321/studio/settings` — add or remove content roots

The bundled `content/demo` folder is a working example. It is excluded from the app's own docs and can be deleted once you add your own roots.

## What you get

- **Multiple content roots**, each with include/exclude globs. Paths can be absolute, relative to the config, or `~/…`.
- **Browse view** using Starlight's layout, sidebar, theme, and table of contents. A **Visual / Code** switch at the top left toggles the rendered page and a read-only source view.
- **Inline editing**: click a paragraph, heading, table, code block, math block, or Mermaid diagram to edit its exact Markdown slice. Task checkboxes rewrite `[ ]` / `[x]` in place.
- **Studio**: Milkdown Crepe visual editor + CodeMirror raw mode, selected with a **Visual / Code / Split** switch at the top left of each document. Frontmatter panel, file filter, word count, and per-file git history with diffs.
- **Split preview**: on wide screens, a live rendered preview sits beside the visual editor. It uses the same Markdown pipeline as the browse view, including KaTeX math, Shiki highlighting, and Mermaid diagrams.
- **Image uploads**: use `/image` in the visual editor, or paste/drop an image. Files are written to an `assets/` folder beside the Markdown file (`notes/assets/…`), linked relatively, and committed immediately.
- **Slash-command cheatsheet**: press `Ctrl+/` or click the keyboard icon in the header to see every Crepe block command and editor shortcut.
- **Autosave** to disk, **debounced auto-commit** of only the edited file, with action-specific messages, and **conflict detection** via content hashes.
- **Local-first security posture**: no database, no auth, bound to `127.0.0.1` by default.

## Markdown support

The browse renderer uses a unified pipeline with:

- GFM: tables, task lists, footnotes, strikethrough, autolinks
- **KaTeX math**: inline `$…$` and display `$$…$$`
- **Mermaid diagrams**: ` ```mermaid ` fenced blocks, rendered client-side
- Shiki code highlighting with light/dark themes
- Raw HTML passthrough
- Relative images and `.md` links rewritten to Storelight asset and browse URLs

The Studio's visual mode renders math through Crepe's KaTeX support. Mermaid blocks stay editable
code blocks, with a diagram **preview button** in the code block toolbar. The **Split** mode mirrors
the browse output in a live pane, and images inserted with `/image` or pasted into the editor are
saved under `<document folder>/assets/` and referenced relative to the document. `.mdx` components
are not supported.

## Configuration

`storelight.config.json` lives next to `package.json`. The Settings page writes it for you.

```json
{
  "roots": [
    {
      "id": "handbook",
      "label": "Team handbook",
      "path": "~/notes/handbook",
      "include": ["**/*.md"],
      "exclude": ["private/**", "node_modules/**", "**/.git/**"]
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

Commit subjects differ by action:

```text
docs(storelight): update content/demo/welcome.md
docs(storelight): update content/demo/welcome.md (raw markdown)
docs(storelight): edit paragraph in content/demo/welcome.md
docs(storelight): toggle task in content/demo/notes/roadmap.md
docs(storelight): add image content/demo/notes/assets/screenshot.png
```

Only the path being edited is staged and committed. Storelight never pushes and never commits unrelated changes.

## Scripts

```bash
pnpm dev       # dev server with on-demand Studio/API
pnpm build     # static Starlight site + Node server bundle
pnpm serve     # run the built server on 127.0.0.1:4321
pnpm check     # Astro + TypeScript diagnostics
```

`STORELIGHT_HOST` and `STORELIGHT_PORT` configure the dev server. The production `pnpm serve` script uses `HOST` and `PORT` internally and defaults to localhost.

## Limitations

- Only `.md` files are editable. `.mdx` is intentionally out of scope.
- Markdown is rendered by a custom unified pipeline, so Starlight/MDX components inside external files render as raw HTML, not as Astro components.
- Inline editing opens the source for a whole block; it is not a rich-text overlay on the rendered DOM.
- Starlight's Pagefind search indexes the site's own docs, not the external roots. Use the Studio's file filter for filenames.
- No authentication. Keep it local, or put a trusted proxy in front of it.

See `/guide` and `/reference` in the running app for the longer explanations.
