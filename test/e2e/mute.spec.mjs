// 음소거 회귀 — 번역 중 음소거하면 엔진으로 가는 오디오에 소리가 남지 않아야 한다(무음 조각만, 연결은 유지).
// 폰 앱 경로(네이티브 마이크 흉내, 큰 소리를 계속 흘림). 가짜 엔진이 '소리가 담긴 조각' 수를 센다.
import { test, expect } from '@playwright/test';
import { login, createSession, engine } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

// 말하는 중인 마이크 흉내 — 큰 소리(잡음)를 40ms 마다
const loudMicStub = () => {
  let tm = null;
  const frame = () => {
    const n = 480; const b = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) { let v = Math.round((Math.random() * 2 - 1) * 0.2 * 32767); if (v < 0) v += 65536; b[2 * i] = v & 255; b[2 * i + 1] = v >> 8; }
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s);
  };
  window.AndroidAudio = { start() { clearInterval(tm); tm = setInterval(() => { if (window.__kacNA) window.__kacNA(frame()); }, 40); return true; }, startStereo() { return 0; }, stop() { clearInterval(tm); }, inputLabel() { return '테스트 마이크'; }, inputs() { return '[]'; }, setInput() { return true; } };
};

test('폰 앱: 음소거하면 소리가 엔진으로 가지 않고, 해제하면 다시 간다', async ({ page }) => {
  await page.addInitScript(loudMicStub);
  await login(page.request);
  await createSession(page.request, { title: 'E2E 음소거', preset: 'oneway', inLang: 'ko' });
  await page.goto('/');
  await page.getByText('E2E 음소거').click();
  await page.getByRole('button', { name: '시작' }).click();
  await expect(page.getByRole('button', { name: '중지' })).toBeAttached();
  await expect.poll(async () => (await engine.conns()).loud, { timeout: 10000 }).toBeGreaterThan(5);

  await page.mouse.click(195, 400); // 번역 중엔 메뉴가 숨는다 — 화면을 눌러 띄운다
  await page.getByRole('button', { name: '음소거', exact: true }).click();
  await page.waitForTimeout(800); // 이미 보낸 조각이 도착할 시간
  const a = await engine.conns();
  await page.waitForTimeout(2500);
  const b = await engine.conns();
  expect(b.loud, '음소거 중에는 소리 있는 조각이 늘면 안 된다').toBe(a.loud);
  expect(b.audio, '연결은 유지(무음 조각은 계속)').toBeGreaterThan(a.audio);

  await page.mouse.click(195, 400);
  await page.getByRole('button', { name: '음소거 해제' }).click();
  await expect.poll(async () => (await engine.conns()).loud, { timeout: 5000 }).toBeGreaterThan(b.loud);
});

// 송신기 2개(2채널) — 켤 때마다 처음 1.2초는 왼쪽(마이크 1)만, 다음 1.2초는 오른쪽(마이크 2)만 크게(마이크 확인 통과용), 그 뒤엔 둘 다 크게
const loudStereoStub = () => {
  let tm = null; let t0 = Date.now();
  const frame = () => {
    const el = Date.now() - t0;
    const lLoud = el < 1200 || el >= 2400, rLoud = el >= 1200;
    const n = 480; const b = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 2; ch++) {
        const amp = (ch === 0 ? lLoud : rLoud) ? 0.2 : 0.002;
        let v = Math.round((Math.random() * 2 - 1) * amp * 32767); if (v < 0) v += 65536;
        b[4 * i + 2 * ch] = v & 255; b[4 * i + 2 * ch + 1] = v >> 8;
      }
    }
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s);
  };
  window.AndroidAudio = { start() { return false; }, startStereo() { clearInterval(tm); t0 = Date.now(); tm = setInterval(() => { if (window.__kacNA2) window.__kacNA2(frame()); }, 40); return 2; }, stop() { clearInterval(tm); }, inputLabel() { return '무선 송신기 2개'; }, inputs() { return '[]'; }, setInput() { return true; } };
};

test('폰 앱 2채널(송신기 2개): 음소거하면 마이크 1·2 모두 엔진으로 가지 않는다', async ({ page }) => {
  await page.addInitScript(loudStereoStub);
  await login(page.request);
  await createSession(page.request, { title: 'E2E 2채널 음소거', preset: 'twoway' });
  await page.goto('/');
  await page.getByText('E2E 2채널 음소거').click();
  await page.getByRole('button', { name: '시작' }).click();
  const check = page.getByRole('dialog', { name: '마이크 확인' });
  await expect(check).toBeVisible();
  await check.getByRole('button', { name: '시작', exact: true }).click({ timeout: 15000 });
  await expect(page.getByRole('button', { name: '중지' })).toBeAttached();
  // 채널마다 엔진 연결 하나씩 — 둘 다 소리가 가는지 먼저 본다
  await expect.poll(async () => (await engine.conns()).open, { timeout: 10000 }).toBe(2);
  const first = await engine.conns();
  await expect.poll(async () => (await engine.conns()).loudAll, { timeout: 10000 }).toBeGreaterThan(first.loud + 5);

  await page.mouse.click(195, 400);
  await page.getByRole('button', { name: '음소거', exact: true }).click();
  await page.waitForTimeout(800);
  const a = await engine.conns();
  await page.waitForTimeout(2500);
  const b = await engine.conns();
  expect(b.loudAll, '음소거 중에는 두 채널 모두 소리 있는 조각이 늘면 안 된다').toBe(a.loudAll);
  expect(b.audioAll, '연결은 유지(무음 조각은 계속)').toBeGreaterThan(a.audioAll);

  await page.mouse.click(195, 400);
  await page.getByRole('button', { name: '음소거 해제' }).click();
  await expect.poll(async () => (await engine.conns()).loudAll, { timeout: 5000 }).toBeGreaterThan(b.loudAll);
});
