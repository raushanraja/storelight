---
title: How Storelight works
description: Content roots, the Studio, inline editing, and automatic git commits.
---

Storelight is a local-first authoring layer on top of Astro Starlight. It never stores your docs in a database: it reads and writes the Markdown files that already exist in your folders.

## Content roots

A **root** is a directory Storelight is allowed to read. Each root has:

- a stable `id` used in URLs,
- a label,
- an absolute path, or a path relative to `storelight.config.json`,
- `include` globs (default: `**/*.md`),
- `exclude` globs.

Every request re-checks the resolved path against the root's file manifest, so `../` paths and files excluded by the globs are rejected. Only `.md` files can be edited.

## Three ways to edit

**Studio** (`/studio`) is a full-screen editor. A tree of all roots sits on the left, and a **Visual / Code / Split** switch at the top left of each document changes the editing mode:

- **Visual** — Milkdown Crepe, with slash commands, tables, task lists, code blocks, links, and KaTeX math.
- **Code** — CodeMirror with the whole file, including frontmatter.
- **Split** — the visual editor beside a live rendered preview. Split is available on wide screens; narrowing the window returns to Visual.

Mermaid fenced blocks stay editable code in the Studio. The code block toolbar has a preview button
that renders the diagram with the same Mermaid configuration used by the browse view. Split mode
renders Mermaid, KaTeX math, and Shiki-highlighted code in the preview pane.

Images can be added with `/image` or by pasting/dropping an image into the visual editor. Storelight
writes the file to an `assets/` folder beside the Markdown document, inserts a relative link, and
commits the image straight away. Press `Ctrl+/` (or the keyboard icon in the header) for the full
slash-command and shortcut cheatsheet.

Frontmatter is edited in a separate YAML panel in Visual mode. The editor never throws it away.

**Inline editing** works on the browse pages. Click a heading, paragraph, table, code block, math
block, or Mermaid diagram to edit that exact slice of Markdown in a small dialog. Task list
checkboxes are live: clicking one rewrites `[ ]` to `[x]` (or back) in the source.

The browse toolbar also has a **Visual / Code** switch. Code shows a read-only view of the raw
Markdown with a copy button; Visual is the rendered page.

**Settings** (`/studio/settings`) manages roots and the auto-commit behaviour. It writes `storelight.config.json` for you.

## Rendering support

The browse pipeline is `remark` + `rehype` and supports:

- GFM tables, task lists, footnotes, strikethrough, autolinks
- KaTeX inline and display math
- Mermaid diagrams rendered in the browser
- Shiki code highlighting with light/dark themes
- Raw HTML
- Rewritten relative images and `.md` links

Math and Mermaid are rendered with the same palette in both themes. Starlight and MDX components
are not evaluated inside external Markdown files; they appear as raw HTML.

## Saving and git

The Studio autosaves after a short pause. Storelight then:

1. writes the file to disk,
2. detects the git repository that contains it,
3. stages **only that file**,
4. commits with a message that reflects the action, after a debounce so a typing burst becomes one commit.

Messages look like:

```text
docs(storelight): update content/demo/notes/roadmap.md
docs(storelight): toggle task in content/demo/notes/roadmap.md
docs(storelight): edit paragraph in content/demo/notes/roadmap.md
docs(storelight): update content/demo/notes/roadmap.md (raw markdown)
docs(storelight): add image content/demo/notes/assets/screenshot.png
```

The debounce and prefix are configurable. Storelight never pushes, never commits unrelated files, and leaves commits alone when auto-commit is disabled.

Inline block edits and checkbox toggles are discrete actions, so they commit immediately. Studio typing uses the debounce. Uploaded images are committed immediately with an `add image` message; the document that links them follows on its normal autosave.

## Conflict handling

Every read returns a SHA-256 hash of the file. Writes send that hash back. If the file changed underneath you, Storelight returns a conflict instead of silently overwriting it and offers to reload or overwrite.

## What is not supported

- `.mdx` files (the editor would have to understand JSX; this app deliberately sticks to Markdown).
- Remote content, databases, or browser-only storage.
- Full-text search across external roots. Starlight's Pagefind index covers the site's own docs; the Studio has a filename filter.
- Deploying this as a multi-user CMS. The API can write files and commit; keep it on localhost.
