# StreakGrid

Study history as a day grid (columns = weeks), on the cobalt ramp from `streak-0` to `streak-4`.

- Pass `days`: one level 0-4 per day in chronological order, starting on a Sunday. `caption` names the span ("Last 26 weeks").
- 12px cells, 3px gap, `radius-xs`. One color ramp only; never GitHub green, never multicolor.
- Pair with `Stat` (current streak) right above; the grid is never the only place the number shows. Falls back to the accessible label "Study history"; the scale reads "less"/"more".
