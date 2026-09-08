# The `ai-cr:*` labels

Repo state, not code. `.github/workflows/ai-code-review.yml` applies these but does not create
them, and `gh pr edit --add-label` validates label existence **client-side** — so all three must
exist before the first workflow run, or every run fails at the labelling step with a confusing
"could not add label" rather than anything about the review.

A fresh clone inherits the workflow but not the labels. Re-run these against any repo the workflow
is deployed to.

Created on `TomaszMarcinkowski1000/GamingLibrary` on 2026-09-07 (plan step 4.1).

```bash
gh label create "ai-cr:passed" --color 0e8a16 \
  --description "Agentic code review passed — set by .github/workflows/ai-code-review.yml"

gh label create "ai-cr:failed" --color b60205 \
  --description "Agentic code review failed — set by .github/workflows/ai-code-review.yml"

gh label create "ai-cr:retry" --color cfd3d7 \
  --description "Add to re-run the agentic code review once; the workflow removes it"
```

Colours are the ones this repository already uses elsewhere — `#0e8a16` is the green on `slice`,
`#b60205` the red on `blocked`, `#cfd3d7` the neutral on `duplicate` — so the new labels read as
part of the existing set rather than a separate scheme.

`ai-cr:passed` and `ai-cr:failed` are mutually exclusive: the workflow applies one and removes the
other, so a PR never carries both. `ai-cr:retry` is the escape hatch — adding it triggers exactly
one new run, and the workflow removes it so a retry cannot loop.

Verify with:

```bash
gh label list --search "ai-cr"
```

To undo: `gh label delete "ai-cr:passed" --yes` (and likewise for the other two).
