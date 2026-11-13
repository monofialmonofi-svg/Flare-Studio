"""Shared timeline for the no-voiceover cut. 100 BPM -> beat 0.6 s, bar 2.4 s. All times in seconds."""
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
DUR = 65.5

# scene boundaries
S1, S2, S3, S4, S5, S6, S7, END = 0.0, 6.0, 15.6, 25.2, 34.8, 44.4, 54.0, DUR

HOOK_IMPACT = 1.0          # impact + face reveal
HEARTBEATS = [0.10, 0.95, 1.85, 2.65, 3.40, 4.10, 4.75, 5.35]
FADE_BLACK = (59.4, 60.2)  # final shot -> black
NAME_T = 60.3              # CRISTIANO RONALDO
THANKS_T = 61.6            # شكراً على الحكاية
FACTS_T = 62.6

# shot cut points that get a whoosh + whip blur (hard, energetic cuts)
WHIP = [8.4, 10.8, 13.2, 23.4, 24.3, 32.4, 46.8, 49.2, 51.6]
# hard impact cuts (impact/bass hit + flash + shake)
IMPACTS = [S2, S3, 17.4, 20.4, S4, 29.0, S6, S7]
# ball-kick accents
KICKS = [10.8, 13.2, 17.4, 20.4, 23.4, 24.3, 49.2]
# crowd/goal-celebration swells (start, length)
ROARS = [(17.4, 3.0), (20.4, 3.0), (23.4, 1.8), (25.2, 4.0), (32.4, 2.4), (51.6, 2.4)]
DISSOLVE = {39.6: 0.8}
