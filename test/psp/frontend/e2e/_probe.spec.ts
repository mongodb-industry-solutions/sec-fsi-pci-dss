import { test } from '@playwright/test';
import { signIn } from './_signIn';
import { writeFileSync } from 'fs';

test('probe: token', async ({ page }) => {
  writeFileSync(process.env.TOKEN_OUT!, await signIn(page));
});
