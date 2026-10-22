# Notes & ideas

A looser page for testing longer prose, links, and formatting.

## Why a local studio?

Most documentation tools want to own the content. Storelight does the opposite: your Markdown stays in your folders, in your repositories, with your history. The app is a window onto those files, not a new source of truth.

That means you can:

* keep using your editor or `git` when you want to,
* point the studio at several repos at once,
* stop using it without a migration.

## A checklist for a new root

* [ ] Is the folder a git repository (or inside one)?
* [ ] Do the include globs match only what you want to expose?
* [ ] Are private drafts excluded?
* [ ] Does the git identity work (`git config user.name`)?
* [ ] Is the path absolute, relative to the config, or `~/…`?

## Longer paragraphs

The **debounce** is the quiet part of the design. Typing in the WYSIWYG editor produces a stream of Markdown updates; saving each one would create a noisy history. Instead, Storelight waits for a pause, writes the final text, then waits again before committing. Inline edits and checkboxes skip the queue because they are intentional, discrete actions.

If the file changes on disk while you have it open, a hash check turns the next save into a conflict rather than a silent overwrite. You get to choose which version wins.

## Scratch table

| Idea                              | Effort | Notes                               |
| --------------------------------- | ------ | ----------------------------------- |
| Word-count goal in the status bar | S      | Mostly presentation                 |
| Backlinks between documents       | M      | Scan links, build an index          |
| Publish selected roots            | L      | Needs an allowlist and a build step |
| Diagram blocks                    | M      | Mermaid or a custom renderer        |

> Try editing this table by clicking it. The dialog gives you the raw Markdown, pipes and all.
