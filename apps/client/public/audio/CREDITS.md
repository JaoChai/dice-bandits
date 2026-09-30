# Audio credits

## Music

Both tracks are released under **CC0 1.0 Universal** (public domain dedication). Licence
confirmed on each asset page on 2026-09-30; attribution is not required but is given here.

### board — "The Arplands"

- Author: LordZintick
- Page: https://opengameart.org/content/the-arplands
- Download: https://opengameart.org/sites/default/files/the_arplands_0.ogg
- Licence: CC0 1.0
- Retrieved: 2026-09-30 (sha256 `54fcd0a72861f143f93ff218e5118691d3629fe0e46714d7d8795e449d60a245`)
- Files: `music/board.ogg`, `music/board.mp3`

### battle — "8bit Action Boss Battle"

- Author: MintoDog
- Page: https://opengameart.org/content/8bit-action-boss-battle
- Download: https://opengameart.org/sites/default/files/8bit_action_boss_battle_bpm145_0.ogg
- Licence: CC0 1.0
- Retrieved: 2026-09-30 (sha256 `56ead67c2f5fa46ac6bd2a2a878b6eee19faac62921ef9d54b7b6ea3e71a9fbd`)
- Files: `music/battle.ogg`, `music/battle.mp3`

### Processing

Both tracks were loudness-matched and re-encoded (source → `<id>`):

```
ffmpeg -i <source>.ogg -af loudnorm=I=-18:TP=-2:LRA=11 -ar 44100 -c:a libvorbis -q:a 2 music/<id>.ogg
ffmpeg -i <source>.ogg -af loudnorm=I=-18:TP=-2:LRA=11 -ar 44100 -c:a libmp3lame -b:a 64k music/<id>.mp3
```

## Sound effects

`sfx/*.wav` are original sounds synthesised by `tools/sfx` in this repository.
