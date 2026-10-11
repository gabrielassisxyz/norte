# Carousel

A horizontal row of cards (home curricula) with arrows that move two entries per click; the edge of the next card stays visible.

- Provide the entries as `children` (usually `CoverCard`), `itemWidth` (248), `visible` (4) and `step` (2). `arrowTop` centers the arrows at cover height.
- The back arrow only appears after moving. Always pair with a "See all" action in `SectionHeader`.
- No autoplay, no pagination dots.
