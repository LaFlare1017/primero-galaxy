/**
 * Render linkedin/carousel.html into the assets LinkedIn wants.
 *
 *   node linkedin/render.mjs
 *
 * Writes to linkedin/export/ (git-ignored):
 *
 *   carousel.pdf        one 1080x1080 page per slide — upload as a DOCUMENT,
 *                       which is the swipeable format
 *   slide-NN-name.png   one image per slide, for a single-image post or a
 *                       reorder by hand
 *
 * Playwright is already a dev dependency of this repo (the e2e suite), so there
 * is nothing to install. It exports at deviceScaleFactor 2, which keeps the type
 * crisp after LinkedIn re-encodes; pass --scale=1 for exactly 1080x1080 files.
 *
 * The deck's own copy carries no numbers: every figure it prints is a slot
 * (`data-stat`, and `data-count` for the slide counters) filled here from
 * linkedin/stats.mjs, which reads them out of the repo. `--check` on stats.mjs
 * proves the markdown; this is what proves the PDF, at the moment it is made.
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { facts, RENDER } from './stats.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'carousel.html');
const outDir = join(here, 'export');
const scaleArg = process.argv.find((arg) => arg.startsWith('--scale='));
const scale = scaleArg ? Number(scaleArg.split('=')[1]) : 2;

/** The slide names, in order, exactly as the HTML declares them. */
async function slideNames(page) {
  return page.$$eval('.slide', (slides) => slides.map((slide) => slide.dataset.name ?? 'slide'));
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1080 },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  await page.goto(`file://${source}`, { waitUntil: 'load' });
  // The deck has no webfont dependency, but a slide half-rendered is a wasted
  // upload, so wait for layout to settle before measuring anything.
  await page.evaluate(() => document.fonts.ready);

  const names = await slideNames(page);

  // Fill the slots from the repo before anything is measured: an empty stat tile
  // is worse than a wrong one, because nobody notices it, so an unknown slot
  // name fails the render rather than printing a blank.
  const f = facts();
  const values = Object.fromEntries(Object.entries(RENDER).map(([key, render]) => [key, render(f)]));
  const slots = await page.evaluate(
    ({ values, slideCount }) => {
      const missing = [];
      const empty = [];
      const filled = {};
      for (const el of document.querySelectorAll('[data-stat]')) {
        const value = values[el.dataset.stat];
        if (value === undefined) missing.push(el.dataset.stat);
        else el.textContent = value;
        if (!el.textContent?.trim()) empty.push(el.dataset.stat);
        else filled[el.dataset.stat] = el.textContent;
      }
      const slides = [...document.querySelectorAll('.slide')];
      const pad = String(slideCount).length;
      slides.forEach((slide, index) => {
        const count = slide.querySelector('[data-count]');
        if (count) count.textContent = `${String(index + 1).padStart(pad, '0')} / ${String(slideCount).padStart(pad, '0')}`;
      });
      return {
        missing,
        empty,
        filled,
        blanks: slides.filter((slide) => !(slide.querySelector('[data-count]')?.textContent ?? '').trim()).length,
        counters: slides.map((slide) => slide.querySelector('[data-count]')?.textContent ?? '').filter(Boolean),
      };
    },
    { values, slideCount: names.length },
  );
  if (slots.missing.length > 0) {
    await browser.close();
    throw new Error(`carousel.html asks for numbers stats.mjs does not define: ${slots.missing.join(', ')}`);
  }
  if (slots.empty.length > 0 || slots.blanks > 0) {
    await browser.close();
    throw new Error(
      `a slide would print a blank figure (${slots.empty.length} stat slots, ${slots.blanks} counters) — an empty number is worse than a wrong one, because nobody notices it`,
    );
  }
  // Printed so a render says which repo state it carries: the numbers are in the
  // PNGs, and a PNG is not greppable.
  console.log(
    `deck figures  ${Object.entries(slots.filled)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ')}`,
  );
  console.log(`slide counters  ${slots.counters[0]} … ${slots.counters.at(-1)} (${slots.counters.length})`);
  await page.waitForTimeout(200);

  // A slide that clips is a slide nobody notices is wrong until it is on
  // LinkedIn, so the geometry is checked rather than eyeballed: the slide itself
  // must not overflow its 1080x1080 box, and neither may the flexible middle.
  const clipped = await page.$$eval('.slide', (slides) =>
    slides
      .map((slide) => {
        const body = slide.querySelector('.body');
        const over = Math.max(
          slide.scrollHeight - slide.clientHeight,
          slide.scrollWidth - slide.clientWidth,
          body ? body.scrollHeight - body.clientHeight : 0,
        );
        return { name: slide.dataset.name ?? 'slide', over };
      })
      .filter((slide) => slide.over > 1),
  );
  if (clipped.length > 0) {
    await browser.close();
    throw new Error(
      `slides overflow their frame — shorten the copy: ${clipped
        .map((slide) => `${slide.name} (+${slide.over}px)`)
        .join(', ')}`,
    );
  }

  const slides = await page.$$('.slide');

  // One image per slide. The slide's name already carries its number
  // (`01-cover`), so the file keeps only one copy of it.
  const written = [];
  for (const [index, slide] of slides.entries()) {
    const slug = names[index].replace(/^\d+-/, '');
    const file = join(outDir, `slide-${String(index + 1).padStart(2, '0')}-${slug}.png`);
    await slide.screenshot({ path: file });
    written.push(file);
  }

  // The carousel itself: print media, one page per slide, page size = slide size.
  await page.emulateMedia({ media: 'print' });
  const pdf = join(outDir, 'carousel.pdf');
  await page.pdf({ path: pdf, width: '1080px', height: '1080px', printBackground: true });
  written.push(pdf);

  await browser.close();

  // A contact sheet, so all ten can be eyeballed in one place before uploading.
  const sheet = join(outDir, 'contact-sheet.html');
  await writeFile(
    sheet,
    `<!doctype html><meta charset="utf-8"><title>Carousel — contact sheet</title>
<style>
  body{margin:0;padding:24px;background:#0b0b12;font:14px ui-sans-serif,system-ui;color:#b0b0c8}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  figure{margin:0}
  img{width:100%;display:block;border-radius:10px;border:1px solid #1a1a3a}
  figcaption{padding-top:6px;font:12px ui-monospace,monospace;color:#8e8eae}
</style>
<div class="grid">
${written
  .filter((file) => file.endsWith('.png'))
  .map(
    (file, index) =>
      `  <figure><img src="${basename(file)}" alt="slide ${index + 1}"><figcaption>${basename(file)}</figcaption></figure>`,
  )
  .join('\n')}
</div>\n`,
  );
  written.push(sheet);

  for (const file of written) {
    const { size } = await stat(file);
    console.log(`${(size / 1024).toFixed(0).padStart(5)} KB  ${file.replace(`${here}/`, '')}`);
  }
  console.log(`\n${names.length} slides → ${written.length} files in linkedin/export/`);
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
