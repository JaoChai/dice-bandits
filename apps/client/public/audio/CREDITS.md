# Audio credits

## Music

Both tracks are released under **CC0 1.0 Universal** (public domain dedication).
The current licence on each asset page was verified on 2026-10-11; attribution
is not required but is given here as requested by the author.

### board — "Town Theme RPG"

- Author: cynicmusic (https://cynicmusic.com, https://pixelsphere.org)
- Page: https://opengameart.org/content/town-theme-rpg
- Download: https://opengameart.org/sites/default/files/TownTheme.mp3
- Licence: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Retrieved: 2026-10-11 (source MP3 sha256 `2657861d5107d4a3c01ef81cb6a4d61ddd5e7a054b6da57e658373d79d0c3466`)
- Files: `music/board.ogg`, `music/board.mp3`
- Modifications: loudness normalisation, resampling to 44.1 kHz and re-encoding;
  no trim.

### battle — "Battle Theme A"

- Author: cynicmusic (https://cynicmusic.com, https://pixelsphere.org)
- Page: https://opengameart.org/content/battle-theme-a
- Download: https://opengameart.org/sites/default/files/battleThemeA.mp3
- Licence: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Retrieved: 2026-10-11 (source MP3 sha256 `6042399782e581d753d616bc703e66483d5eccb5fb687a20c9a552d68c49e620`)
- Files: `music/battle.ogg`, `music/battle.mp3`
- Licence evidence: the current asset page explicitly says CC0. Older comments
  refer to CC-BY-SA/CC-BY, which are superseded by the author's current CC0 grant.
- Modifications: trimmed to 0–94.8 s (removing 1.05 s of trailing silence), then
  loudness normalisation, resampling to 44.1 kHz and re-encoding.

### Processing

The published sources are MP3; no OGG source is published. The Lead prepared the
encodes below, which were copied without further processing. Board uses the whole
source; battle is trimmed before the same existing -18 LUFS / -2 dBTP loudness
normalisation. OGG uses libvorbis q2; MP3 uses libmp3lame at 64 kbit/s.

```sh
ffmpeg -i TownTheme.mp3 -af loudnorm=I=-18:TP=-2:LRA=11 -ar 44100 -c:a libvorbis -q:a 2 music/board.ogg
ffmpeg -i TownTheme.mp3 -af loudnorm=I=-18:TP=-2:LRA=11 -ar 44100 -c:a libmp3lame -b:a 64k music/board.mp3
ffmpeg -i battleThemeA.mp3 -t 94.8 -af loudnorm=I=-18:TP=-2:LRA=11 -ar 44100 -c:a libvorbis -q:a 2 music/battle.ogg
ffmpeg -i battleThemeA.mp3 -t 94.8 -af loudnorm=I=-18:TP=-2:LRA=11 -ar 44100 -c:a libmp3lame -b:a 64k music/battle.mp3
```

Encoded file SHA256 checksums:

```text
f0bde16d6a7ba2e876e4560ad83dbb0a3aaef4799a6421ee69ce2e812897e416  music/board.ogg
5ef3cec88b16f934e07b741c737aa15279e0de928bcf60531cfe891f63011a99  music/board.mp3
da0a074d53f026f712a3537ae85d62ef3bea63b01fc906acb3af19165f66e745  music/battle.ogg
96bff9bbc17641d29cf4b309800595932621d5313eb3b6ed16dd5ca9735b64e9  music/battle.mp3
```

## Sound effects

`sfx/*.wav` are original sounds synthesised by `tools/sfx` in this repository.
