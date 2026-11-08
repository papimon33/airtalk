// 음소거 회귀 — PC 브라우저 마이크 경로(크롬 가짜 마이크: 1초마다 삐 소리). mute.spec.mjs 와 짝.
import { test, expect } from '@playwright/test';
import { login, createSession, engine } from './helpers.mjs';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['microphone'] });

test('PC: 음소거하면 소리가 엔진으로 가지 않고, 해제하면 다시 간다', async ({ page }) => {
  await login(page.request);
  const s = await createSession(page.request, { title: 'E2E PC 음소거', preset: 'oneway', inLang: 'ko' });
  await page.goto('/s/' + s.id);
  await page.getByRole('button', { name: '시작' }).click();
  await expect(page.getByRole('button', { name: '중지' })).toBeVisible({ timeout: 10000 });
  await expect.poll(async () => (await engine.conns()).loud, { timeout: 10000 }).toBeGreaterThan(2);

  await page.getByRole('button', { name: '음소거', exact: true }).click();
  await page.waitForTimeout(1000);
  const a = await engine.conns();
  await page.waitForTimeout(3000); // 삐 소리가 세 번 이상 지나간다
  const b = await engine.conns();
  expect(b.loud, '음소거 중에는 소리 있는 조각이 늘면 안 된다').toBe(a.loud);
  expect(b.audio, '연결은 유지(무음 조각은 계속)').toBeGreaterThan(a.audio);

  await page.getByRole('button', { name: '음소거 해제' }).click();
  await expect.poll(async () => (await engine.conns()).loud, { timeout: 6000 }).toBeGreaterThan(b.loud);
});
