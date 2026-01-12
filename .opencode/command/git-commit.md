---
description: Draft git commit command
---

# Draft git commit command

RUN git status --short
RUN git diff
RUN git diff --staged
RUN git log -5 --oneline

Analyze the changes and propose a concise commit title and body (1–2 sentences) that match repo style. If there are no changes, say so.

Add relevant untracked files and stage changes, then create the commit with the generated title and body using:
`git add -A`
`git commit -m "<title>" -m "<body>"`

Do NOT push.
