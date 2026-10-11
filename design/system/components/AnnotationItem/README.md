# AnnotationItem

An entry of the annotation panel list. Three shapes: linked to a passage (passage + note + margin number), highlight only (passage + "Highlight only" + "+ Annotate this passage"), and loose (badge "No passage"; or "No passage · became a question").

- Provide `quote` and/or `note`, `n` for the margin number, `location` (section, chapter, page) and `time`.
- `kind` resolves on its own; pass `question` for an annotation that became a curiosity-list question.
