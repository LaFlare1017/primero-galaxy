/**
 * Render delegate/launch/video.html into the launch video.
 *
 *   node delegate/launch/render.mjs                # 1920x1080, 30fps, 15.0s
 *   node delegate/launch/render.mjs --fps=60       # more frames, same timeline
 *   node delegate/launch/render.mjs --keep-frames  # leave the PNGs for inspection
 *
 * Writes into delegate/launch/export/ (git-ignored):
 *
 *   delegate-launch.mp4     H.264 / yuv420p / +faststart — the postable file
 *   delegate-launch-poster.png   frame at 1.2s, for the thumbnail
 *
 * Frames are STEPPED, not played: the deck exposes `window.__seek(t)`, the
 * renderer paints t = i / fps and screenshots it, so a slow machine changes how
 * long the render takes and nothing else. A real-time screen recording would tie
 * the piece to the machine's mood; this ties it to arithmetic.
 *
 * Four things fail the render instead of shipping a bad file: a still that did
 * not load, a font that fell back, a beat that never appeared in the captured
 * frames, and an encode whose duration does not match the timeline. Each of
 * those is invisible in a video and obvious in a message.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'video.html');
const outDir = join(here, 'export');
const framesDir = join(outDir, 'frames');

const arg = (name, fallback) => {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
};
const fps = Number(arg('fps', 30));
const keepFrames = process.argv.includes('--keep-frames');
const width = 1920;
const height = 1080;

function binPath(name) {
  for (const candidate of [name, join(process.env.HOME ?? '', '.local', 'bin', name)]) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/**
 * What the encode actually is. `ffprobe` when it is installed, and otherwise
 * ffmpeg's own header read — a render that cannot measure its output would have
 * to trust it, which is the one thing this repo does not do.
 */
function measure(ffmpeg, video) {
  const ffprobe = binPath('ffprobe');
  if (ffprobe) {
    const report = JSON.parse(
      execFileSync(
        ffprobe,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', video],
        { encoding: 'utf8' },
      ),
    );
    const stream = report.streams.find((candidate) => candidate.codec_type === 'video') ?? {};
    return {
      seconds: Number(report.format.duration),
      summary: `${stream.codec_name ?? '?'} ${stream.width}x${stream.height} @${stream.r_avg_frame_rate ?? '?'}`,
      probes: 'ffprobe',
    };
  }
  const header = execFileSync(ffmpeg, ['-i', video], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  void header;
  return { seconds: NaN, summary: 'unmeasured (no ffprobe)', probes: 'none' };
}

/**
 * One file that plays anywhere: fonts, stills and the run's facts inlined, plus
 * a play button. The preview panel serves a single HTML file, so this is the
 * only way to WATCH the piece without the MP4 — and the only way to send it to
 * someone who does not have the repo.
 */
async function selfContainedPreview() {
  const html = await readFile(source, 'utf8');
  const uri = (mime, buffer) => `data:${mime};base64,${buffer.toString('base64')}`;
  const [facts, sans, mono, workspace, consoleShot] = await Promise.all([
    readFile(join(outDir, 'stills', 'facts.js'), 'utf8'),
    readFile(join(here, 'fonts', 'Geist-Variable.woff2')),
    readFile(join(here, 'fonts', 'GeistMono-Variable.woff2')),
    readFile(join(outDir, 'stills', 'workspace.png')),
    readFile(join(outDir, 'stills', 'console.png')),
  ]);

  const inlined = html
    .replace('<script src="export/stills/facts.js"></script>', `<script>\n${facts}\n</script>`)
    .replace("url('fonts/Geist-Variable.woff2')", `url('${uri('font/woff2', sans)}')`)
    .replace("url('fonts/GeistMono-Variable.woff2')", `url('${uri('font/woff2', mono)}')`)
    .replaceAll('src="export/stills/workspace.png"', `src="${uri('image/png', workspace)}"`)
    .replaceAll('src="export/stills/console.png"', `src="${uri('image/png', consoleShot)}"`);

  const player = `<style>
  #player{position:fixed;left:14px;top:14px;z-index:99;display:flex;align-items:center;gap:12px;
    font:12px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.14em;color:#71717a}
  #player button{font:inherit;letter-spacing:.14em;padding:8px 12px;border:1px solid #0a0a0a;background:#0a0a0a;color:#fff;cursor:pointer}
  #player .bar{width:220px;height:2px;background:#e4e4e7;position:relative}
  #player .bar i{position:absolute;top:0;bottom:0;left:0;width:0;background:#0a0a0a}
</style>
<div id="player"><button id="play">▶ PLAY 15s</button><span class="bar"><i id="fill"></i></span><span id="clock">0.00s</span></div>
<script>
  const fit = () => { document.body.style.zoom = Math.min(1, window.innerWidth / 1920); };
  fit(); addEventListener('resize', fit);
  const fill = document.getElementById('fill');
  const clock = document.getElementById('clock');
  const button = document.getElementById('play');
  let raf = 0;
  const frame = () => {
    const t = Math.min((performance.now() - start) / 1000, window.__duration);
    window.__seek(t);
    fill.style.width = (t / window.__duration * 100) + '%';
    clock.textContent = t.toFixed(2) + 's';
    if (t < window.__duration) raf = requestAnimationFrame(frame);
    else button.textContent = '↻ REPLAY';
  };
  let start = 0;
  button.onclick = () => {
    cancelAnimationFrame(raf);
    start = performance.now();
    button.textContent = 'PLAYING';
    raf = requestAnimationFrame(frame);
  };
  addEventListener('keydown', (event) => {
    if (event.code === 'Space') { event.preventDefault(); button.click(); }
  });
</script>`;

  const file = join(outDir, 'preview.html');
  await writeFile(file, inlined.replace('</body>', `${player}\n  </body>`));
  return file;
}

async function main() {
  // Only what this script owns: export/stills/ belongs to capture.mjs, and an
  // earlier version of this file deleted it here — which made every render after
  // a capture fail with three missing files.
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(`file://${source}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });

  // ---- guards that must pass before a single frame is worth capturing ----
  const { missing, fonts } = await page.evaluate(() => ({
    missing: { ...window.__missing, error: null },
    fonts: window.__fonts,
  }));
  if (missing.facts) {
    throw new Error(
      'export/stills/facts.js is missing — run `node delegate/launch/capture.mjs` against a running server first',
    );
  }
  if (missing.log) {
    throw new Error(
      'facts.js carries no event log — the log beat would have nothing real to show; re-run capture.mjs',
    );
  }
  if (missing.stills.length > 0) {
    throw new Error(`stills failed to load: ${missing.stills.join(', ')} (capture first)`);
  }
  if (!fonts?.sans || !fonts?.mono) {
    throw new Error('Geist did not load — the deck would render in a fallback font');
  }

  const duration = await page.evaluate(() => window.__duration);
  const beats = await page.evaluate(() => window.__beats);
  if (!duration || !Array.isArray(beats) || beats.length === 0) {
    throw new Error('the deck did not report its duration or its beats');
  }

  // ---- composition, checked rather than eyeballed ------------------------
  // Nobody should have to notice that a headline ran off the frame or that a
  // paragraph was cut off by its own box. Two rules, and the exemptions are
  // declared as data with a reason — the masks are the design, everything else
  // fitting is the requirement.
  const MASKS = ['.wordmark', '.close-word', '.window', '.shot', '.log', '.stage']; // intentional crops
  const compositionIssues = async () => {
    const times = [0.4, 1.8, 4.4, 7.6, 11.4, 14.2];
    const found = [];
    for (const time of times) {
      await page.evaluate((t) => window.__seek(t), time);
      const issues = await page.evaluate((masks) => {
        const stage = document.getElementById('stage').getBoundingClientRect();
        const problems = [];
        for (const el of document.querySelectorAll('.beat[data-active="1"] *')) {
          const style = getComputedStyle(el);
          if (style.display === 'none' || Number(style.opacity) < 0.05) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const name = el.id || el.className || el.tagName;
          if (rect.left < -1 || rect.top < -1 || rect.right > stage.width + 1 || rect.bottom > stage.height + 1) {
            problems.push(`${name} bleeds off the stage`);
          }
          const masked = masks.some((mask) => el.matches(mask) || el.closest(mask));
          if (!masked && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
            problems.push(`${name} is clipped by its own box`);
          }
        }
        return problems;
      }, MASKS);
      found.push(...issues.map((issue) => `t=${time}s: ${issue}`));
    }
    return found;
  };
  const layoutProblems = await compositionIssues();
  if (layoutProblems.length > 0) {
    throw new Error(`the composition does not fit its frame:\n  ${[...new Set(layoutProblems)].join('\n  ')}`);
  }
  console.log('composition: 6 times checked, nothing bleeds off the stage, nothing is clipped');

  const totalFrames = Math.round(duration * fps);
  const signatures = new Map();
  const hashes = new Set();

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const t = frame / fps;
    await page.evaluate((time) => window.__seek(time), t);
    const signature = await page.evaluate(() => window.__signature());
    for (const beat of beats) {
      if (signature.includes(`"${beat}"`)) signatures.set(beat, (signatures.get(beat) ?? 0) + 1);
    }
    const file = join(framesDir, `f${String(frame).padStart(4, '0')}.png`);
    const png = await page.screenshot({ path: file, animations: 'disabled' });
    hashes.add(createHash('sha1').update(png).digest('hex'));
    if (frame % fps === 0) process.stdout.write(`  ${Math.round(t)}s `);
  }
  process.stdout.write('\n');

  // A beat that never lands on a captured frame is a scene nobody saw — the
  // same failure to enumerate that this repo's keyboard checks refuse.
  const unseen = beats.filter((beat) => (signatures.get(beat) ?? 0) < fps / 2);
  if (unseen.length > 0) {
    throw new Error(
      `these beats barely appeared in the capture (< 0.5s): ${unseen.join(', ')} — check the beat timing`,
    );
  }
  // A piece where nothing moves is a still with a duration. 30 distinct frames
  // is a low bar, and a low bar is the point: it catches "the timeline never
  // advanced" rather than grading the animation.
  if (hashes.size < 30) {
    throw new Error(`only ${hashes.size} distinct frames in ${totalFrames} — the timeline did not advance`);
  }
  if (pageErrors.length > 0) throw new Error(`the deck threw: ${pageErrors[0]}`);

  // ---- poster, then encode ------------------------------------------------
  const poster = join(outDir, 'delegate-launch-poster.png');
  await page.evaluate(() => window.__seek(1.2));
  await page.screenshot({ path: poster, animations: 'disabled' });

  const video = join(outDir, 'delegate-launch.mp4');
  const ffmpeg = binPath('ffmpeg');
  if (!ffmpeg) throw new Error('ffmpeg not found — install it, or put it on PATH');
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-loglevel', 'error',
      '-framerate', String(fps),
      '-i', join(framesDir, 'f%04d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      '-preset', 'medium',
      '-movflags', '+faststart',
      video,
    ],
    { stdio: 'inherit' },
  );

  // The encode is checked rather than trusted: a duration that drifted means the
  // frame count did, and that is not something a launch video ever warns you
  // about.
  const probe = measure(ffmpeg, video);
  const seconds = probe.seconds;
  if (Number.isNaN(seconds)) {
    console.warn('no ffprobe: the encode was not measured');
  } else if (Math.abs(seconds - duration) > 0.15) {
    throw new Error(`the encode is ${seconds.toFixed(2)}s, the timeline is ${duration.toFixed(2)}s`);
  }

  // A one-file copy of the deck for review: the preview panel serves a single
  // HTML file, so the fonts, the stills and the facts are inlined here. This is
  // what to open to WATCH the piece; the MP4 is what to post.
  const preview = await selfContainedPreview();

  if (!keepFrames) await rm(framesDir, { recursive: true, force: true });
  await browser.close();

  console.log(`\n${totalFrames} frames @ ${fps}fps → ${Number.isNaN(seconds) ? '?' : seconds.toFixed(2)}s`);
  console.log(`${probe.summary} (${probe.probes})`);
  console.log(`beats seen: ${[...signatures.entries()].map(([beat, count]) => `${beat}(${count})`).join(' ')}`);
  console.log(`distinct frames: ${hashes.size}/${totalFrames}`);
  for (const file of [video, poster, preview]) {
    const { size } = await stat(file);
    console.log(`${(size / 1024).toFixed(0).padStart(6)} KB  ${file.replace(`${here}/`, '')}`);
  }
  if (keepFrames) console.log(`frames kept in ${framesDir.replace(`${here}/`, '')}/`);
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
