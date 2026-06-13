# BP Training

A browser-based simulator for teaching **manual blood pressure measurement** by
auscultation. An instructor sets a target blood pressure; the student practices
taking it with a virtual aneroid sphygmomanometer and stethoscope — inflating
the cuff, releasing the valve, and listening for Korotkoff sounds to read
systolic and diastolic pressure.

Built for the **NJ Association of EMS Educators**. No build step, no
dependencies — just static HTML, CSS, and vanilla JavaScript.

## How it works

The app has two pages:

| Page | File | Purpose |
|------|------|---------|
| **Instructor Setup** | `index.html` | Enter a target systolic / diastolic / heart rate, or hit **Student Practice** to randomize one. Launches the exercise. |
| **Student Exercise** | `student.html` | A working sphygmomanometer the student drives to measure the hidden pressure, then submits a reading for scoring. |

The target reading is passed between pages via `sessionStorage` — nothing is sent
to a server.

### For the student

1. Put on headphones.
2. Press **Pump** repeatedly to inflate the cuff above the suspected systolic
   pressure (typically 180–200 mmHg).
3. Press **Open Valve** to bleed pressure slowly (~2–3 mmHg/sec).
4. Listen through the stethoscope:
   - The pressure at the **first** audible Korotkoff tap is the **systolic**.
   - The pressure where the taps **disappear** is the **diastolic**.
5. Enter the reading; the app scores it against the target.

## Features

- **Realistic aneroid gauge** — dial graduated every 2 mmHg, with major marks
  every 10 and numeric labels every 20, just like a real cuff.
- **Korotkoff sound synthesis** — taps are generated with the Web Audio API and
  change character across the auscultatory phases (sharp taps → muffling). The
  taps **fade in** just below systolic and **fade out** approaching diastolic,
  so the student has to genuinely listen rather than read a cue. Volume is fixed
  loud for laptop speakers.
- **Mechanical air sounds** — a short air "whoosh" plays on each pump, and a
  soft continuous hiss of escaping air plays the whole time the valve is open
  (it stops when the valve closes or the cuff empties).
- **Live needle bounce** — the gauge needle gives a slight flick on every
  Korotkoff beat, like a real aneroid gauge pulsing with the heartbeat.
- **Randomized practice** — the **Student Practice** button generates a
  clinically plausible, even-numbered blood pressure for unsupervised drilling.
  Values are written straight to `sessionStorage`, so the student never glimpses
  the answer.
- **No spoilers by default** — the digital pressure readout is **hidden by
  default** (a checkbox can reveal it), forcing the student to read the analog
  gauge. The simulator also gives no visual cue for when sounds are audible.

## Running it

It's a static site — no install or build required.

**Option A — open directly:**
Open `index.html` in a browser. (Audio requires a click to start, which the Pump
button provides.)

**Option B — serve locally** (recommended, avoids any file:// quirks):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Headphones required

Korotkoff sounds are low-frequency thumps. They're hard to hear on laptop
speakers — use headphones for an accurate exercise.

## Embedding in another site

Two prebuilt, fully self-contained single-file versions are included (CSS, JS,
and the logo all inlined; both screens combined into one document):

- **`bp-training-embed.html`** — a standalone page. Host it and drop it in an
  `<iframe>`. This repo is published via **GitHub Pages**, so the hosted copy is
  already live at:
  `https://allyholtz21.github.io/bp-training/bp-training-embed.html`

  ```html
  <iframe src="https://allyholtz21.github.io/bp-training/bp-training-embed.html"
          width="100%" height="850" style="border:0;" title="BP Training"
          allow="autoplay"></iframe>
  ```

- **`bp-training-fragment.html`** — the same widget with no document wrapper, for
  pasting directly into a CMS "Custom HTML / Embed" block (e.g. Weebly). All
  styles are scoped to `#bp-app` so they won't clash with the host page.

> Both embed files are **generated** from `bp-training-embed.html`; if you edit
> the main app files, regenerate them. The hosted iframe updates automatically a
> minute or two after pushing to `main` (GitHub caches files ~10 min, so use a
> `?v=` query string to force a fresh copy when testing).

## Project structure

```
index.html                Instructor setup page + randomizer
student.html              Student exercise page (gauge + controls)
student.js                Gauge rendering, audio synthesis, deflation physics, scoring
styles.css                All styling
emtref-01-1.jpg           NJ Association of EMS Educators logo
bp-training-embed.html    Self-contained single-file build (for hosting / iframe)
bp-training-fragment.html Inline fragment build (for CMS embed blocks)
```

## License

Educational use for the NJ Association of EMS Educators.
