import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export const maxDuration = 30;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; login: string }> }
) {
  const { owner, repo, login } = await params;

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const renderUrl = `${origin}/card-render/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(login)}`;

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: {
        width: 800,
        height: 600,
        deviceScaleFactor: 2,
      },
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();

    const response = await page.goto(renderUrl, {
      waitUntil: 'networkidle2',
      timeout: 20000,
    });

    if (!response || response.status() === 404) {
      return new Response('Card not found', { status: 404 });
    }

    await page.waitForSelector('#card-wrapper', { timeout: 10000 });

    // Wait for all images to finish loading
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', resolve);
          });
        })
      );
    });

    const cardElement = await page.$('#card-wrapper');
    if (!cardElement) {
      return new Response('Card element not found', { status: 500 });
    }

    const screenshot = await cardElement.screenshot({
      type: 'png',
      omitBackground: true,
    });

    const buffer = Buffer.from(screenshot);
    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (error: any) {
    console.error('Card screenshot error:', error?.message || error);
    return new Response(`Failed to generate card image: ${error?.message || 'Unknown error'}`, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
