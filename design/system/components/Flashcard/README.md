# Flashcard

Anki-style spaced review: front, revealed answer, and four rating buttons with the next interval.

- Provide `deck`, `position` ("12/40"), `front`, `back`, `intervals` (the four coming intervals) and `onRate(rating)`.
- Before reveal: only the front and "Show answer" (primary) with the key cue. After: the answer below a divider and the "Again" / "Hard" / "Good" / "Easy" buttons - "Good" is primary, "Again" has its label in `danger`.
- Shortcuts: "space" reveals; 1-4 rate. The swap is a 200ms crossfade, never a 3D flip.
