/**
 * The root route: the explainer landing page's contact form, the rule that the
 * contact address ships only base64-encoded, and that every CTA lands in the
 * galaxy tool at /galaxy.
 *
 * None of these mount the 3D scene, which is what makes them the cheapest
 * tests in the suite and the ones most worth running alongside it.
 *
 * Split out of the single 22-test `galaxy.spec.ts`; see galaxy-helpers.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  waitForGalaxyBoot,
  STAR_COUNT,
  type GalaxyHandle,
} from './galaxy-helpers';

test('the landing page contact form renders and submits a pre-filled mailto', async ({ page }) => {
  // The root route is the explainer landing page.
  await page.goto('/');

  // The form lives in the #contact section, below the fold. Match by the
  // heading's accessible name (the rendered heading breaks across lines).
  await expect(
    page.getByRole('heading', { name: 'Ready to map your own AI transformation?' })
  ).toBeVisible();

  // All three fields render, and the submit button is inert until a message
  // is typed (the textarea is required).
  const name = page.getByLabel('Your name');
  const email = page.getByLabel('Your email');
  const message = page.getByLabel('Message');
  const send = page.getByRole('button', { name: 'Send message' });
  await expect(name).toBeVisible();
  await expect(email).toBeVisible();
  await expect(message).toBeVisible();
  await expect(send).toBeVisible();
  await expect(send).toBeDisabled();

  await name.fill('Jane Smith');
  await email.fill('jane@company.com');
  await message.fill(
    'We would love a full maturity assessment for our logistics arm.'
  );
  await expect(send).toBeEnabled();

  // Submitting opens the visitor's mail app pre-filled. Chromium surfaces
  // the mailto navigation as a (failed, external-protocol) request; assert
  // on that instead of a real navigation.
  const mailto = page.waitForEvent('request', (r) => r.url().startsWith('mailto:'));
  await send.click();
  const mailtoUrl = new URL((await mailto).url());

  // The gated Primero address is the recipient; kept base64 here, mirroring
  // the app, so the address never appears as plaintext in the repo.
  expect(mailtoUrl.pathname).toBe(atob('SG9kbGVyb25AZ21haWwuY29t'));
  expect(mailtoUrl.searchParams.get('subject')).toBe(
    'Primero Galaxy: contact from Jane Smith'
  );
  const body = mailtoUrl.searchParams.get('body');
  expect(body).toContain('We would love a full maturity assessment');
  expect(body).toContain('Jane Smith (jane@company.com)');

  // The confirmation renders after submit.
  await expect(
    page.getByText('Opening your email app. Your message is ready to send.')
  ).toBeVisible();
});

test('the contact address ships nowhere in the served page or JS (only base64)', async ({ page }) => {
  // The address is concealed: it exists only as base64 inside the client
  // bundle and is decoded at submit time. If anyone later renders it (or the
  // minifier folds the encoded string back to plaintext), this test catches
  // it. The plaintext is decoded at runtime here too, so it never appears as
  // a literal in the repo, mirroring the app's concealment.
  const JS_BASE64 = 'SG9kbGVyb25AZ21haWwuY29t'; // base64 of the gated address
  const ADDRESS = atob(JS_BASE64);
  const NAME = ADDRESS.split('@')[0];

  // Collect every JS response the landing page (and any prefetched routes)
  // actually fetches.
  const jsUrls = new Set<string>();
  page.on('response', (res) => {
    const type = res.headers()['content-type'] ?? '';
    if (type.includes('javascript')) jsUrls.add(res.url());
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Union with every script/preload reference in the served HTML, so the
  // scan covers the full static chunk list regardless of fetch timing.
  const html = await page.content();
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.js(?:[?#][^"]*)?)"/g)) {
    jsUrls.add(new URL(m[1], page.url()).toString());
  }

  const jsBodies = (
    await Promise.all(
      [...jsUrls].map(async (u) => {
        const res = await page.request.get(u);
        return res.ok() ? res.text() : '';
      })
    )
  ).join('\n');

  // The rendered page: no address, no name, and not even the base64 form.
  expect(html).not.toContain(ADDRESS);
  expect(html).not.toContain(NAME);
  expect(html).not.toContain(JS_BASE64);

  // The bundles: the only trace is the base64 form. The positive assertion
  // proves the scan actually covered the encoded address (not vacuous).
  expect(jsBodies).toContain(JS_BASE64);
  expect(jsBodies).not.toContain(ADDRESS);
  expect(jsBodies).not.toContain(NAME);
});

test('every landing-page CTA lands in the galaxy tool at /galaxy', async ({ page }) => {
  // Each CTA boots the tool, so budget past the suite default.
  test.setTimeout(180_000);

  const ctas = [
    {
      label: 'hero',
      // The hero is the first section; scope there so the final-CTA link of
      // the same name can't satisfy this assertion.
      link: page
        .locator('section')
        .first()
        .getByRole('link', { name: 'Enter the galaxy →' }),
    },
    {
      label: 'contact',
      link: page.getByRole('link', { name: 'Add your company to the galaxy' }),
    },
    {
      label: 'final CTA',
      // Scoped by its heading so a section added later can't shift the
      // "last section" and silently change which link gets clicked.
      link: page
        .locator('section')
        .filter({
          has: page.getByRole('heading', {
            name: 'Your company could be one of the stars.',
          }),
        })
        .getByRole('link', { name: 'Enter the galaxy →' }),
    },
    { label: 'footer', link: page.getByRole('link', { name: 'Launch the galaxy ↗' }) },
  ];

  for (const { label, link } of ctas) {
    await page.goto('/');
    await expect(link).toBeVisible();
    await link.click();

    // The CTA lands in the tool and the galaxy actually boots: URL, canvas,
    // and the app debug handles registered by the fresh mount.
    await expect(page).toHaveURL(/\/galaxy$/);
    await expect(page.locator('canvas')).toBeVisible();
    await waitForGalaxyBoot(page);
    const starCount = await page.evaluate(() => {
      let count = 0;
      (window.__galaxy as GalaxyHandle).r3f.scene.traverse((o: any) => {
        if (o.isInstancedMesh) count = o.count;
      });
      return count;
    });
    expect(starCount, `${label} CTA should land in the ${STAR_COUNT}-star galaxy`).toBe(STAR_COUNT);
  }
});

/**
 * Sample the landing page's reactive-lines canvas: a hash of sampled pixels
 * (animation moves the lines, so any redraw changes the hash), a count of
 * line pixels, and a count of void-background pixels (#030308). The void
 * Sample the landing hero's starfield canvas: a hash of sampled pixels
 * (breathing stars move, so any redraw changes the hash) and a count of
 * non-transparent pixels. The star count is the painted-vs-blank
 * discriminator: an unpainted canvas has zero star pixels.
 */
