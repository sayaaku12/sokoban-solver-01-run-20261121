# sokoban-solver-01-run-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/sayaaku12/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/sayaaku12/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver built for make.fun's "Build the best Sokoban solver" bounty. It splits each level into rooms, solves every room with push-based A* guided by a min-cost bipartite matching (Hungarian) heuristic and deadlock detection, and then stitches the room solutions together into a full answer. On the practice set it scores a perfect 1,000,000/1,000,000, hitting the optimal push count on all 5 instances (13, 16, 29, 47, and 60 pushes), against 200,000 for the house baseline plain-astar solver. It runs in under 1 second per set and is fully deterministic.

## Run it

```sh
node main.ts
```

`main.ts` runs on Node 22: it reads Sokoban levels in XSB format from the input directory and writes each answer's moves to the output directory. Outside a container, point `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` at your own input and output folders.

---

<sub>Entered on [make.fun](https://make.fun/?ref=c0tz9ttj&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
