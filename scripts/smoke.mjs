import { _electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
fs.mkdirSync('test-results', { recursive: true });
const app = await _electron.launch({
  args: ['.', '--safe-mode'],
  env: { ...process.env, CUEFORGE_DATA: path.resolve('test-results/profile') },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text());
  });
  await page.getByRole('button', { name: 'Добавить аудио', exact: true }).waitFor();
  console.log((await page.locator('body').innerText()).slice(0, 12000));
  console.log(
    'DEVICES',
    await page.evaluate(() =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((ds) =>
          ds.map((d) => ({ kind: d.kind, id: d.deviceId, label: d.label, group: d.groupId })),
        ),
    ),
  );
  await page.screenshot({ path: 'test-results/empty.png' });
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.screenshot({ path: 'test-results/settings.png' });
} finally {
  await app.close();
}
