/**
 * The hero starfield canvas and the WebGL-unavailable paths.
 *
 * The starfield tests read pixels: a hash of sampled pixels distinguishes an
 * animating canvas from a static one, and the star-pixel count is the
 * painted-vs-blank discriminator. The WebGL tests launch their own browser
 * with rendering disabled, which is why they take `browser` rather than `page`.
 *
 * Split out of the single 22-test `galaxy.spec.ts`; see galaxy-helpers.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { waitForApp, type GalaxyHandle } from './galaxy-helpers';



async function readStarfieldFrame(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return { hash: -1, starPx: 0 };
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    let starPx = 0;
    for (let i = 0; i < d.length; i += 16) {
      hash = ((hash * 31 + d[i]) | 0) ^ (d[i + 1] << 4) ^ (d[i + 2] << 8);
      if (d[i + 3] > 0) starPx++;
    }
    return { hash, starPx };
  });
}

test('the hero starfield paints and animates immediately on load', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // The frame painted on mount with NO interaction; the animation starts on
  // load, not after a scroll or pointer event.
  await expect
    .poll(async () => (await readStarfieldFrame(page)).starPx, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // The field animates: breathing + drift change the sampled frame.
  const first = await readStarfieldFrame(page);
  await expect
    .poll(async () => (await readStarfieldFrame(page)).hash, { timeout: 10_000 })
    .not.toBe(first.hash);
});

test('the hero starfield draws one static frame under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // A single static frame painted on mount.
  await expect
    .poll(async () => (await readStarfieldFrame(page)).starPx, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const first = await readStarfieldFrame(page);

  // Time passes: the canvas must NOT animate (frames stay identical).
  await page.waitForTimeout(400);
  expect((await readStarfieldFrame(page)).hash).toBe(first.hash);
});

test('the hero starfield scales its star budget down for mobile viewports', async ({ page }) => {
  // The per-frame canvas cost is dominated by star count on phones, so the
  // component derives the budget from viewport area. The debug handle lets
  // the suite assert the smaller viewport actually draws fewer stars.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => window.__heroStars?.() ?? -1), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  const desktop = await page.evaluate(() => window.__heroStars!());

  await page.setViewportSize({ width: 390, height: 844 });
  // The resize handler debounces at 100ms before rebuilding the field.
  await page.waitForTimeout(400);
  const mobile = await page.evaluate(() => window.__heroStars!());

  expect(desktop).toBeGreaterThan(0);
  expect(mobile).toBeGreaterThan(0);
  expect(mobile, 'mobile hero should draw fewer stars than desktop').toBeLessThan(desktop);
});

test('brands without indexed favicons ship stable local logos instead of 404ing', async ({ page }) => {
  // Every top-20 marquee brand ships a bundled white mark under /logos/marquee
  // (planet panels keep their own assets under /logos). Berkshire's tile must
  // load from the bundled set, never from the favicon service, and no
  // favicon-service request may 404 during the landing-page load.
  const faviconFailures: string[] = [];
  page.on('response', (res) => {
    const url = res.url();
    if (/(gstatic\.com|google\.com\/s2)/.test(url) && res.status() >= 400) {
      faviconFailures.push(`${url} -> ${res.status()}`);
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Scroll the marquee into view so its lazy-loaded images actually load.
  await page
    .getByRole('heading', { name: /AI MATURITY ASSESSMENTS FOR THE FOLLOWING/i })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);

  // Both marquee copies of Berkshire's tile use the bundled white mark, and it
  // is visible (the monogram fallback never fired).
  const berkshireTile = page.locator('img[src*="/logos/marquee/berkshire-hathaway"]');
  await expect(berkshireTile).toHaveCount(2);
  await expect(berkshireTile.first()).toBeVisible();
  const res = await page.request.get('/logos/marquee/berkshire-hathaway.png');
  expect(res.status()).toBe(200);

  // No favicon-service request failed for any brand on the page.
  expect(faviconFailures, faviconFailures.join('\n') || 'no failures').toEqual([]);
});

test('brands without indexed favicons ship stable local logos in the planet panel', async ({ page }) => {
  // Berkshire Hathaway has no favicon indexed by the favicon service, so its
  // planet-panel logo must load from /logos via the shared logoUrl helper,
  // and no favicon-service request may 404 while the profile is open.
  const faviconFailures: string[] = [];
  page.on('response', (res) => {
    const url = res.url();
    if (/(gstatic\.com|google\.com\/s2)/.test(url) && res.status() >= 400) {
      faviconFailures.push(`${url} -> ${res.status()}`);
    }
  });

  await waitForApp(page);

  // Open Berkshire's planet panel through the search palette.
  await page.getByRole('button', { name: 'Search' }).click();
  const input = page.getByRole('combobox', { name: 'Search companies' });
  await expect(input).toBeVisible();
  await input.fill('Berkshire');
  const option = page.getByRole('option', { name: /Berkshire/ });
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');

  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 15_000,
    })
    .toBe('planet');
  await expect(page.getByRole('heading', { name: 'Berkshire Hathaway' })).toBeVisible();

  // The profile logo is the local asset (the monogram fallback never fired),
  // and it serves 200.
  const logo = page.locator('img[src*="/logos/berkshire-hathaway"]');
  await expect(logo).toBeVisible();
  const res = await page.request.get('/logos/berkshire-hathaway.svg');
  expect(res.status()).toBe(200);

  // No favicon-service request 404ed while the profile was open.
  expect(faviconFailures, faviconFailures.join('\n') || 'no failures').toEqual([]);
});

test('the galaxy degrades gracefully when WebGL is unavailable', async ({ browser }) => {
  // Force WebGL off so the Three.js renderer cannot create a context, exactly
  // like a browser with hardware acceleration disabled or a GPU blocklist.
  const noWebGL = await browser.browserType().launch({
    args: ['--disable-webgl', '--disable-webgl2', '--disable-software-rasterizer'],
  });
  const page = await noWebGL.newPage({ baseURL: 'http://localhost:3100' });
  const uncaught: string[] = [];
  page.on('pageerror', (err: Error) => uncaught.push(String(err)));

  await page.goto('/galaxy');
  await page.waitForLoadState('networkidle');

  // The explanatory fallback renders instead of the raw Next.js
  // "Application error" boundary page.
  await expect(
    page.getByRole('heading', { name: /The galaxy needs WebGL to render/i })
  ).toBeVisible();
  await expect(
    page.getByText(/which your browser or device is currently blocking/i)
  ).toBeVisible();

  // Both escape hatches from the fallback are real routes.
  await expect(page.getByRole('link', { name: 'Read the methodology' })).toHaveAttribute(
    'href',
    '/methodology'
  );
  await expect(page.getByRole('link', { name: '← Back to home' })).toHaveAttribute('href', '/');

  // No uncaught client-side exception reaches the page.
  await page.waitForTimeout(1500);
  expect(uncaught).toEqual([]);
  await noWebGL.close();
});

test('the landing page warns before Enter the galaxy when WebGL is unavailable', async ({ browser }) => {
  // Same WebGL-off launch as the galaxy fallback test: a browser that cannot
  // create a WebGL context must be told before it clicks into the 3D scene.
  const noWebGL = await browser.browserType().launch({
    args: ['--disable-webgl', '--disable-webgl2', '--disable-software-rasterizer'],
  });
  const page = await noWebGL.newPage({ baseURL: 'http://localhost:3100' });
  const uncaught: string[] = [];
  page.on('pageerror', (err: Error) => uncaught.push(String(err)));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // The hero warning appears once the client-side probe resolves, with a
  // real escape hatch to the methodology research trail.
  const notice = page.getByText(/Your browser has WebGL turned off/i);
  await expect(notice).toBeVisible();
  await expect(
    notice.getByRole('link', { name: /full methodology and every company's research trail/i })
  ).toHaveAttribute('href', '/methodology');

  // No uncaught client-side exception reaches the page.
  await page.waitForTimeout(1000);
  expect(uncaught).toEqual([]);
  await noWebGL.close();

  // Control: with WebGL available the notice never renders (no flash on the
  // supported path that the rest of the suite exercises).
  const okPage = await browser.newPage({ baseURL: 'http://localhost:3100' });
  await okPage.goto('/');
  await okPage.waitForLoadState('networkidle');
  await expect(okPage.getByText(/Your browser has WebGL turned off/i)).toHaveCount(0);
  await okPage.close();
});

test('the share button invokes the native Web Share API when available', async ({ page }) => {
  let shared: { title?: string; text?: string; url?: string } | null = null;
  await page.addInitScript(() => {
    // Stub the native share sheet: capture the payload instead of opening UI.
    (window as any).__sharedPayload = null;
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: async (data: any) => {
        (window as any).__sharedPayload = data;
      },
    });
  });
  await waitForApp(page);

  await page.getByRole('button', { name: 'Share galaxy' }).click();

  shared = await page.evaluate(() => (window as any).__sharedPayload);
  expect(shared).not.toBeNull();
  expect(shared!.title).toContain('AI Transformation Galaxy');
  expect(shared!.text).toContain('Fortune 500');
  expect(shared!.url).toMatch(/\/galaxy$/);
});

test('the share button copies the URL when the Web Share API is unavailable', async ({ page, context }) => {
  // No navigator.share in headless Chromium by default, which is exactly the
  // fallback path: the button must copy the current URL to the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await waitForApp(page);

  const share = page.getByRole('button', { name: 'Share galaxy' });
  await expect(share).toBeVisible();
  await share.click();

  // The button flips to a transient "Copied" state for screen readers and
  // the visible label; the clipboard holds the galaxy URL.
  await expect(share).toContainText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/\/galaxy$/);
});
