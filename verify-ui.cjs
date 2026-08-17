const { chromium } = require('D:/HuaweiMoveData/Users/戴颖/Desktop/codex4everything/.artifact_cityu_is/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', error => errors.push(error.message));
  const target = process.env.VERIFY_URL || ('file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/'));
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const cardCount = await page.locator('.listing-card').count();
  const photoCount = await page.locator('.card-photo img').count();
  const galleryUrl = await page.evaluate(() => Object.entries(window.RENTAL_IMAGES).find(([url, images]) => images.length > 0 && rentals.some(rental => rental.url === url))?.[0]);
  await page.evaluate(url => openDetail(url), galleryUrl);
  await page.locator('#detailDialog[open]').waitFor();
  const thumbCount = await page.locator('[data-gallery-index]').count();
  const firstImage = await page.locator('#detailHero').getAttribute('src');
  if (await page.locator('#galleryNext').count()) await page.locator('#galleryNext').click();
  const secondImage = await page.locator('#detailHero').getAttribute('src');
  await page.locator('#detailFavorite').click();
  await page.locator('[data-rating-key="hard"] [data-value="4"]').click();
  await page.locator('#detailNote').fill('采光不错，复看时重点检查空调噪音。');
  const currentUrl = await page.locator('.source-button').getAttribute('href');
  await page.locator('#closeDetail').click();
  await page.evaluate(url => openDetail(url.replace(/\?.*$/, '')), currentUrl);
  await page.locator('#detailHero').evaluate(image => image.decode());
  const heroState = await page.locator('#detailHero').evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight, src: image.currentSrc }));
  const persisted = {
    favorite: await page.locator('#detailFavorite').textContent(),
    rating: await page.locator('[data-rating-key="hard"] [data-value="4"]').getAttribute('class'),
    note: await page.locator('#detailNote').inputValue()
  };
  await page.screenshot({ path: path.resolve(__dirname, 'preview-detail-modal.png') });
  await page.locator('#closeDetail').click();
  await page.locator('#photoSelect').selectOption('without');
  const withoutImageCount = await page.locator('.listing-card').count();
  await page.locator('#photoSelect').selectOption('all');
  await page.locator('#rentMinRange').evaluate(input => { input.value = '4000'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#rentMaxRange').evaluate(input => { input.value = '5000'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  const rentRangeState = {
    label: await page.locator('#rentValue').textContent(),
    count: Number(await page.locator('#visibleCount').textContent()),
    visibleRents: await page.locator('.card-rent strong').allTextContents()
  };
  await page.locator('#rentMinRange').evaluate(input => { input.value = '2400'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  const firstCommunity = await page.locator('#communitySelect option').nth(1).getAttribute('value');
  await page.locator('#communitySelect').selectOption(firstCommunity);
  const selectedCommunityCards = await page.locator('.listing-card').count();
  const selectedCommunityNames = await page.locator('.listing-card h3').allTextContents();
  await page.screenshot({ path: path.resolve(__dirname, 'preview-detail-ui.png'), fullPage: true });
  console.log(JSON.stringify({ cardCount, photoCount, thumbCount, galleryChanged: firstImage !== secondImage, heroState, persisted, withoutImageCount, rentRangeState, firstCommunity, selectedCommunityCards, selectedCommunityNames, errors }, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
