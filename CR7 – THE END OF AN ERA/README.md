# CR7 – THE END OF AN ERA?

A vertical, trailer-style football documentary reel about Cristiano Ronaldo's career with Portugal. It has **no voiceover**: the story is told through photos, an instrumental score, sound design and short Arabic titles.

| File | What it is |
|---|---|
| `Final_1080x1920.mp4` | The finished reel: H.264 High, 1080×1920 (9:16), 30 fps, about 9 Mb/s, AAC 320 kb/s, loudness −14 LUFS, 65.5 s |
| `Thumbnail.jpg` | 1080×1920 cover image |
| `EXTERNAL_ASSETS/` | The downloaded photos and fonts, plus `ASSET_SOURCES_AND_LICENSES.txt` (author, licence, URL and date for each item) |
| `Project_Files/` | The scripts, the music and SFX stems, and the prepared assets, so the edit can be rebuilt or changed |

**Audio:** instrumental music and sound effects only. There is no narration, no speech of any kind (synthetic or recorded), no singing and no lyrics.

---

## 1. Fact-check (checked 5 Nov 2026)

Every statistic and achievement shown on screen was checked:

| On screen | Status | Source |
|---|---|---|
| Retirement («أعلن اعتزاله اللعب الدولي في 5 نوفمبر 2026», on the end card) | Confirmed. He announced it on 5 Nov 2026 | [CNN](https://www.cnn.com/2026/11/05/sport/cristiano-ronaldo-retires-portuguese-national-team), [ESPN](https://www.espn.com/soccer/story/_/id/49266866/cristiano-ronaldo-portugal-jorge-jesus-retires-international), [AP/ABC](https://abcnews.com/Sports/wireStory/portugal-great-cristiano-ronaldo-announced-retirement-international-soccer-137870659), [NBC](https://www.nbcnews.com/sports/soccer/cristiano-ronaldo-announces-international-retirement-portugal-rcna607602) |
| «23 عاماً من المجد» · 2003 — 2026 | Confirmed. He debuted in 2003 and retired in 2026 | CNN |
| «234 مباراة دولية» | Confirmed. This is the men's all-time record | AP via ABC News |
| «146 هدفاً» | Confirmed. This is the all-time record | AP via ABC News |
| «بطل أوروبا 2016» | Confirmed | UEFA |
| «بطل دوري الأمم الأوروبية» · 2019 • 2025 | Confirmed. Portugal won it in 2019 and 2025 | [beIN Sports](https://www.beinsports.com/en-us/soccer/uefa-nations-league/articles/its-duty-done-ronaldo-hails-portugals-second-nations-league-title-2025-06-09) |

The match captions on each shot ("CROATIA v PORTUGAL · 2013" and so on) come from the photos' Wikimedia Commons metadata.

---

## 2. Edit structure (100 BPM; every cut lands on the beat grid)

| Time | Picture | Text | Sound |
|---|---|---|---|
| 0:00–0:06 | Black, then a close-up from the 2026 World Cup revealed by a light sweep | «هل دي فعلاً آخر مرة؟» | Heartbeat, impact and bass hit, deep drone, reverse riser |
| 0:06–0:15.6 | Walking out (2013) → fans in Lisbon at Euro 2016 → vs Argentina (2011) → vs Brazil (2007) | «23 عاماً من المجد» · «حلم أصبح أسطورة» | Gradual orchestral build, crowd rising, whooshes and ball kicks on cuts |
| 0:15.6–0:25.2 | Blurred red backgrounds, then quick cuts of 2025 goal celebrations | «الأرقام تتكلم» → 234 «مباراة دولية» → 146 «هدفاً» | Heavy percussion, an impact and goal-crowd roar on each number |
| 0:25.2–0:34.8 | Euro 2016 vs Poland → Portugal crest → thumbs-up (2025), gold grade | «بطل أوروبا 2016» · «بطل دوري الأمم الأوروبية» 2019 • 2025 | Anthem: full drums, brass and soaring lead |
| 0:34.8–0:44.4 | Sitting on the grass (2026 World Cup) → close-up, desaturated | (no text) | Piano and strings, percussion out |
| 0:44.4–0:54 | Goat/7 key art → walking (2026) → push into his face | «الحكاية ما انتهت» | Orchestral climax, risers |
| 0:54–1:05.5 | Walking away in the No. 7 shirt, fade to black, title card | CRISTIANO RONALDO · «شكراً على الحكاية ❤️» | Final hit, crowd echo, piano with echoes, final chord |

To make it feel like a trailer rather than a slideshow, the edit uses punch-in zooms on hard cuts, whip-pan motion blur with whooshes, a slight handheld drift, warm light leaks on big cuts, flashes and shakes on impacts, and a dissolve in the emotional section.

---

## 3. Assets and limitations

- **Photos:** 13 real photos of Ronaldo playing for Portugal, 2007–2026, from Wikimedia Commons (CC BY / CC BY-SA). They were reframed, graded and animated; no face or body was altered, and nothing is AI-generated. The end card credits the photographers; paste this full credit line into the post description too:
  > Photos: Bryan Berlin, YantsImages, Chensiyuan, Jules Verne Times Two (CC BY-SA 4.0); Fanny Schertzer, Ludovic Péron (CC BY-SA 3.0); wonker (CC BY 2.0), via Wikimedia Commons. Edited (cropped, graded). Key art: Alwan.
- **Key art:** the client's poster (goat/7) and the «ألوان» logo.
- **Music and SFX:** all original, synthesised from code in `Project_Files/scripts/build_audio.py`, with no samples or third-party music. Stems are in `Project_Files/audio_stems/`.
- **Video footage:** there is still none. Commons has no freely licensed Ronaldo match video. Mixkit and Pixabay showed a CAPTCHA, so I stopped there as instructed. Official UEFA/FIFA/FPF footage needs a paid licence. Each shot is one entry in the `SHOTS` table in `render.py`, so licensed clips can be swapped in later.

## 4. Rebuilding

Requirements: Python 3, `numpy scipy pillow` (with raqm) and `soundfile`, plus ffmpeg. The photos and fonts come from `EXTERNAL_ASSETS/`. The scripts expect a working folder that contains `fonts/`, `assets/` (from `prep_assets.py`) and `ext/photos/`.

```
python3 build_audio.py WORK WORK/build      # score + SFX + timeline (timeline_novo.py)
python3 render.py      WORK WORK/build w0   # run w0..w3 in parallel, one per quarter
# concat seg_final_0..3.mp4, mux with the loudness-normalised mix (-14 LUFS, -1.5 dBTP)
```
