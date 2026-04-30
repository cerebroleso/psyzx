const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto('https://localhost:5173/');
  await page.waitForTimeout(2000); // wait for load
  
  const p = await page.evaluate(() => {
     let player = document.querySelector('#player');
     let fullPlayer = document.querySelector('#full-player');
     return {
        playerParent: player ? player.parentElement.tagName + '#' + player.parentElement.id : 'not found',
        fullPlayerParent: fullPlayer ? fullPlayer.parentElement.tagName + '#' + fullPlayer.parentElement.id : 'not found',
        playerZIndex: player ? window.getComputedStyle(player).zIndex : 'not found',
        fullPlayerZIndex: fullPlayer ? window.getComputedStyle(fullPlayer).zIndex : 'not found',
     };
  });
  console.log(p);
  await browser.close();
})();
