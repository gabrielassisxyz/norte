# SyncStatus

Local-first state, small and quiet. One tinted dot plus the word; never the dot alone.

- `state`: `saved` (default), `syncing`, `offline`, `conflict`. `label` replaces the default text. Defaults read "Saved locally", "Syncing", "Offline · saved locally", "Conflict to review".
- Lives in the app bar or in the `meta` slot of `PageTitle`. Conflict is the only state that asks for attention (`danger`).
