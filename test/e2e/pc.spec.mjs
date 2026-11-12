// PC 화면 — 위 띠(로고·설정), 주소(/s/<세션>·/admin/<탭>), 폰과 같은 설정·새 세션·세션 화면
import { test, expect } from '@playwright/test';
import { login, createSession } from './helpers.mjs';

test.use({ viewport: { width: 1280, height: 800 } });

test('세션 주소로 바로 열고, 새로고침·없는 주소', async ({ page }) => {
  await login(page.request);
  const s = await createSession(page.request, { title: 'E2E PC', preset: 'oneway' });
  await page.goto('/s/' + s.id);
  await expect(page.getByText('E2E PC').first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp('/s/' + s.id + '$'));
  await expect(page.getByText('E2E PC').first()).toBeVisible();

  await page.goto('/desks'); // 데스크 안내 메뉴는 없앴다 → 목록
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/s/nope-does-not-exist');
  await expect(page).toHaveURL(/\/$/);
});

test('계정 메뉴 → 관리자 페이지 탭 이동(안내데스크 탭 없음)', async ({ page }) => {
  await login(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: '계정 메뉴' }).click();
  await page.getByRole('menuitem', { name: '관리자 페이지' }).click();
  await expect(page).toHaveURL(/\/admin\/usage$/);
  const tabs = page.getByRole('tablist', { name: '관리자 메뉴' });
  await expect(tabs.getByRole('tab')).toHaveText(['사용량', '로그', '계정 관리', '용어 설정', '시스템·보안']);
  await tabs.getByRole('tab', { name: '로그' }).click();
  await expect(page).toHaveURL(/\/admin\/logs$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/usage$/);
  await page.goto('/admin/desks'); // 없앤 탭 → 사용량
  await expect(page).toHaveURL(/\/admin\/usage$/);
  await page.getByRole('button', { name: '세션 목록' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('새 세션 — 안내데스크는 따로, 만들면 같은 목록에', async ({ page }) => {
  await login(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: '새 세션' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('radio', { name: /안내데스크/ }).click();
  await expect(dlg.getByPlaceholder(/안내데스크/)).toBeVisible(); // 기본 이름이 바뀐다
  await dlg.getByRole('button', { name: '만들기' }).click();
  await expect(page).toHaveURL(/\/s\/[^/]+$/);
  const id = page.url().split('/s/')[1];
  const got = await (await page.request.get('/api/sessions/' + id)).json();
  expect(got.pipeline).toBe('desk');
  await page.goto('/');
  await expect(page.getByText('안내데스크', { exact: true }).first()).toBeVisible();
});

test('실시간 번역·양방향 세션 — 아래 조작 바: 언어는 늘 보이고, ⌄ 로 마이크 설정, ⋯ 로 세션 메뉴', async ({ page }) => {
  await login(page.request);
  const s = await createSession(page.request, { title: 'E2E 세션 화면', preset: 'twoway' });
  await page.goto('/');
  await page.getByText('E2E 세션 화면').first().click();
  await expect(page).toHaveURL(new RegExp('/s/' + s.id + '$'));
  await expect(page.getByRole('button', { name: '시작' })).toBeVisible();
  // 언어: 끌어 올리는 패널 없이 바에 바로 보인다
  await expect(page.getByRole('button', { name: /^내 언어: / })).toBeVisible();
  await page.getByRole('button', { name: /^상대 언어: / }).click();
  await page.getByPlaceholder('언어 검색').fill('일본');
  await page.getByRole('radio', { name: /일본어.*Japanese/ }).click(); // 모든 언어에 영어 이름도 함께
  await expect(page.getByRole('button', { name: '상대 언어: 일본어' })).toBeVisible();
  // 두 언어 바꾸기
  await page.getByRole('button', { name: '두 언어 바꾸기' }).click();
  await expect(page.getByRole('button', { name: '내 언어: 일본어' })).toBeVisible();
  // 마이크 ⌄
  await page.getByRole('button', { name: '마이크 설정' }).click();
  await expect(page.getByText('입력 소스')).toBeVisible();
  await page.getByText('입력 소스').hover(); // 옆으로 목록이 펼쳐진다(디스코드 음성 메뉴처럼)
  await expect(page.getByRole('radio', { name: '마이크 + 시스템 오디오' })).toBeVisible();
  await expect(page.getByText('자동으로 감도 조절')).toHaveCount(0);
  await expect(page.getByText('고급 설정')).toHaveCount(0);
  await expect(page.getByText('입력 테스트')).toBeVisible();
  await page.keyboard.press('Escape');
  // ⋯
  await page.getByRole('button', { name: '더 보기' }).click();
  await expect(page.getByRole('slider', { name: '텍스트 크기' })).toBeVisible(); // 막대로 바로 조절
  await expect(page.getByRole('menuitem', { name: '세션 삭제' })).toHaveCount(0); // 세션 안에서는 삭제하지 않는다
  await page.keyboard.press('Escape');
  // 모드는 위 띠에서(번역 전)
  await page.getByRole('button', { name: /^모드: 양방향 통역/ }).click();
  await expect(page.getByRole('menuitem', { name: /실시간 번역/ })).toBeVisible();
});

test('설정 창 — 폰과 같은 항목(일반·음성·화면·계정), 테마를 바꾸면 바로 반영, 첫 사용 안내·+ 버튼 없음', async ({ page }) => {
  await login(page.request);
  await page.goto('/');
  await expect(page.getByText('처음이신가요?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '새 세션' })).toBeVisible(); // 위 줄 버튼(떠 있는 + 버튼 대신)
  await page.getByRole('button', { name: '계정 메뉴' }).click();
  await page.getByRole('menuitem', { name: '설정' }).click();
  const dlg = page.getByRole('dialog', { name: '설정' });
  for (const name of ['일반', '음성', '화면', '계정']) await expect(dlg.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(dlg.getByText('시스템 언어')).toBeVisible();
  await dlg.getByRole('button', { name: '화면', exact: true }).click();
  await dlg.getByRole('radio', { name: '다크' }).click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(31, 30, 29)');
  await dlg.getByRole('radio', { name: '라이트' }).click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await dlg.getByRole('button', { name: '계정', exact: true }).click();
  await expect(dlg.getByText('관리자 계정은 서버 설정에서 관리합니다.')).toBeVisible();
});

test('새 세션 창 — 언어를 고르면 세션에 그대로 쓰이고, 안내데스크를 고르면 언어 칸이 사라진다', async ({ page }) => {
  await login(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: '새 세션' }).first().click();
  const dlg = page.getByRole('dialog').first();
  await dlg.getByRole('radio', { name: /양방향 통역/ }).click();
  await dlg.getByRole('button', { name: /상대 언어/ }).click();
  await page.getByRole('radio', { name: /일본어|日本語/ }).click();
  await expect(dlg.getByRole('button', { name: /상대 언어: (일본어|日本語)/ })).toBeVisible();
  await dlg.getByRole('radio', { name: /안내데스크/ }).click();
  await expect(dlg.getByRole('button', { name: /상대 언어/ })).toHaveCount(0);
  await dlg.getByRole('radio', { name: /양방향 통역/ }).click();
  await dlg.getByLabel('세션 이름').fill('E2E 언어 선택');
  await dlg.getByRole('button', { name: '만들기' }).click();
  await expect(page).toHaveURL(/\/s\//);
  const id = new URL(page.url()).pathname.split('/').pop();
  expect(await page.evaluate((i) => localStorage.getItem('kac-sx-pair:' + i), id)).toBe('ko|ja');
});

test('같은 계정으로 다른 PC 로그인 — 확인 창, 이전 PC 는 이유와 함께 로그인 화면', async ({ browser, request }) => {
  await login(request);
  await request.post('/api/admin/users', { data: { id: 'e2e-kim', password: 'kimpw1', perms: { tts: false, desk: false } } });
  const signIn = async (page) => {
    await page.goto('/');
    await page.getByLabel('ID').fill('e2e-kim');
    await page.getByLabel('비밀번호').fill('kimpw1');
    await page.getByRole('button', { name: '로그인' }).click();
  };
  const a = await browser.newPage();
  await signIn(a);
  await expect(a.getByRole('button', { name: '계정 메뉴' })).toBeVisible();

  const b = await browser.newPage();
  await signIn(b);
  const dlg = b.getByRole('dialog');
  await expect(dlg.getByText('다른 기기에서 사용 중인 계정입니다')).toBeVisible();
  await dlg.getByRole('button', { name: '로그인' }).click();
  await expect(b.getByRole('button', { name: '계정 메뉴' })).toBeVisible();

  await a.reload();
  await expect(a.getByText('다른 기기에서 이 계정으로 로그인해 로그아웃되었습니다.')).toBeVisible();
  await a.close();
  await b.close();
});

test('관리자 > 계정 관리 — 권한 스위치', async ({ page }) => {
  await login(page.request);
  await page.request.post('/api/admin/users', { data: { id: 'e2e-lee', password: 'leepw1' } });
  await page.goto('/admin/accounts');
  const sw = page.getByRole('switch', { name: 'e2e-lee TTS' });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();
  const users = await (await page.request.get('/api/admin/users')).json();
  expect(users.find((u) => u.id === 'e2e-lee').perms).toEqual({ tts: true, desk: false });
});

test('안내데스크 권한이 없으면 새 세션 창에 안내데스크 항목이 없다', async ({ page }) => {
  await login(page.request);
  await page.request.post('/api/admin/users', { data: { id: 'e2e-nodesk', password: 'nodeskpw' } });
  await page.request.post('/api/logout');
  expect((await page.request.post('/api/login', { data: { id: 'e2e-nodesk', password: 'nodeskpw', replace: true } })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '새 세션' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('실시간 번역', { exact: true })).toBeVisible();
  await expect(dlg.getByRole('radio', { name: /안내데스크/ })).toHaveCount(0);
});

test('로그인 화면 — 로그인 버튼 아래 데스크톱 앱 받기 링크', async ({ page }) => {
  await page.goto('/');
  const a = page.getByRole('link', { name: '데스크톱 앱 받기' });
  await expect(a).toBeVisible();
  expect(await a.getAttribute('href')).toMatch(/^\/download\/desktop\?platform=(mac|win)$/);
});

// 보안 점검(2026-11-12): 다른 계정의 세션은 주소를 알아도 열리지 않는다(없는 주소와 같게 목록으로 돌아간다)
test('남의 세션 주소는 열리지 않는다', async ({ page, browser }) => {
  await login(page.request);
  const mine = await createSession(page.request, { title: 'E2E 관리자 세션', preset: 'oneway' });
  await page.request.post('/api/admin/users', { data: { id: 'e2e-other', password: 'otherpw1' } });
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  const r = await other.request.post('/api/login', { data: { id: 'e2e-other', password: 'otherpw1', replace: true } });
  expect(r.ok()).toBeTruthy();
  expect((await other.request.get('/api/sessions/' + mine.id)).status()).toBe(403);
  await other.goto('/s/' + mine.id);
  await expect(other).toHaveURL(/\/$/);
  await expect(other.getByText('E2E 관리자 세션')).toHaveCount(0);
  await ctx.close();
});

test('관리자 > 시스템 — 서버가 본 접속 주소가 보인다', async ({ page }) => {
  await login(page.request);
  await page.goto('/admin/system');
  await expect(page.getByText(/서버가 본 내 접속 주소: /)).toBeVisible();
});
