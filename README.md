# GTA VI launch-day Twitch forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/wansanju9-byte/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/wansanju9-byte/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Entry for [Forecast GTA VI's launch-day Twitch viewers hour by hour](https://make.fun/bounty/gta6-twitch-ccu-forecast-01) on [make.fun](https://make.fun/r/00dvrnv4) — $250 in USDC.

## What it does

`main.ts` reads one case (`/input/<id>.in`) and writes `/output/<id>.out`:
for each of hours 2–24 of the release day, five quantiles (5%, 25%, 50%,
75%, 95%) of that hour's Twitch concurrent viewers.

A launch day has a shape: hour 1 is quiet, viewers dip, jump when the US
unlocks around 05:00 UTC, sag around midday, and peak in the evening
(hours 17–22). How big that rise is depends on how big hour 1 already
is. So for each hour the program fits, over the case's own comparables
(past big launches), a weighted regression of
`log(viewers_h / viewers_1)` on `log(viewers_1)`. Comparables with a
rolling midnight-local unlock — the same unlock GTA VI has — count triple.
The spread is the regression's residual spread, slightly narrowed (×0.9).

## Practice score

On the four practice launches, scored against the public source the kit
cites, this scores a mean log pinball loss of **about 0.18**, against
**0.387** for the house baseline. It is deterministic, standard library
only, no network, no clock, no randomness.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```
