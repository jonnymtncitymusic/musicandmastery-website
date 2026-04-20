import puppeteer from 'puppeteer';

const WIDTH_IN = 33;
const HEIGHT_IN = 81;

// CSS pixels at 96 px/in (browser standard)
const CSS_W = WIDTH_IN * 96;  // 3168
const CSS_H = HEIGHT_IN * 96; // 7776

const OUTPUT = process.argv[2] || '/Users/jonny_dolan/Desktop/MCMC-Farmers-Market-Banner.pdf';

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Set viewport to the full physical size in CSS pixels
  await page.setViewport({ width: CSS_W, height: CSS_H });

  await page.goto('http://localhost:3000/banner.html', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);

  // Override banner to fill the full physical page
  await page.addStyleTag({
    content: `
      @page {
        size: ${WIDTH_IN}in ${HEIGHT_IN}in;
        margin: 0;
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
        display: block !important;
      }
      .banner {
        width: ${WIDTH_IN}in !important;
        height: ${HEIGHT_IN}in !important;
        box-shadow: none !important;
      }
      /* Scale section heights proportionally (original: 608+365+850+607 = 2430px → 81in) */
      .hero { height: ${(608/2430) * HEIGHT_IN}in !important; }
      .illustration-band { height: ${(365/2430) * HEIGHT_IN}in !important; }
      .benefits { height: ${(850/2430) * HEIGHT_IN}in !important; }
      .cta-section { height: ${(607/2430) * HEIGHT_IN}in !important; }

      /* Scale typography proportionally (3.2x from 990px to 3168px) */
      .hero-logo { width: ${280 * 3.2}px !important; }
      .hero-company { font-size: ${32 * 3.2}px !important; margin-bottom: ${36 * 3.2}px !important; }
      .hero-headline { font-size: ${72 * 3.2}px !important; max-width: none !important; }
      .hero { padding: ${40 * 3.2}px ${60 * 3.2}px !important; }

      .hero-note-1 { width: ${60 * 3.2}px !important; }
      .hero-note-2 { width: ${45 * 3.2}px !important; }
      .hero-note-3 { width: ${50 * 3.2}px !important; }
      .hero-note-4 { width: ${55 * 3.2}px !important; }
      .hero-note-5 { width: ${35 * 3.2}px !important; }
      .hero-note-6 { width: ${40 * 3.2}px !important; }

      .hero::before {
        width: ${800 * 3.2}px !important;
        height: ${800 * 3.2}px !important;
        top: ${-100 * 3.2}px !important;
      }

      .illustration-band {
        gap: ${50 * 3.2}px !important;
        padding: ${50 * 3.2}px ${60 * 3.2}px ${40 * 3.2}px !important;
      }
      .illustration-band::before { height: ${60 * 3.2}px !important; top: ${-30 * 3.2}px !important; }
      .instrument-icon svg { width: ${120 * 3.2}px !important; height: ${120 * 3.2}px !important; }
      .instrument-icon span { font-size: ${22 * 3.2}px !important; }
      .instrument-icon { gap: ${12 * 3.2}px !important; }

      .benefits {
        padding: ${60 * 3.2}px ${70 * 3.2}px !important;
        gap: ${50 * 3.2}px !important;
      }
      .benefit { gap: ${36 * 3.2}px !important; }
      .benefit + .benefit { padding-top: ${50 * 3.2}px !important; }
      .benefit-icon {
        width: ${110 * 3.2}px !important;
        height: ${110 * 3.2}px !important;
        min-width: ${110 * 3.2}px !important;
      }
      .benefit-icon svg { width: ${50 * 3.2}px !important; height: ${50 * 3.2}px !important; }
      .benefit-title { font-size: ${44 * 3.2}px !important; }
      .benefit-desc { font-size: ${28 * 3.2}px !important; }
      .benefit-text { gap: ${8 * 3.2}px !important; padding-top: ${8 * 3.2}px !important; }

      .cta-section {
        gap: ${40 * 3.2}px !important;
        padding: ${40 * 3.2}px ${80 * 3.2}px !important;
      }
      .cta-button {
        font-size: ${40 * 3.2}px !important;
        padding: ${32 * 3.2}px ${72 * 3.2}px !important;
        border-radius: ${60 * 3.2}px !important;
      }
      .scan-label { font-size: ${22 * 3.2}px !important; margin-top: ${-16 * 3.2}px !important; }
      .qr-area { gap: ${30 * 3.2}px !important; margin-top: ${10 * 3.2}px !important; }
      .qr-code {
        width: ${250 * 3.2}px !important;
        height: ${250 * 3.2}px !important;
        border-radius: ${12 * 3.2}px !important;
        padding: ${8 * 3.2}px !important;
      }
      .contact-info { gap: ${12 * 3.2}px !important; }
      .contact-line { gap: ${14 * 3.2}px !important; font-size: ${28 * 3.2}px !important; }
      .contact-line svg { width: ${28 * 3.2}px !important; height: ${28 * 3.2}px !important; }

      .cta-section::before { left: ${80 * 3.2}px !important; right: ${80 * 3.2}px !important; }
    `
  });

  await page.pdf({
    path: OUTPUT,
    width: `${WIDTH_IN}in`,
    height: `${HEIGHT_IN}in`,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    printBackground: true,
    preferCSSPageSize: true,
    scale: 1
  });

  console.log(`PDF saved to ${OUTPUT}`);
  console.log(`Page: ${WIDTH_IN}" x ${HEIGHT_IN}" | Viewport: ${CSS_W}x${CSS_H}px`);
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
