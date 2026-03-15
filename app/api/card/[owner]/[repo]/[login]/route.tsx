import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export const maxDuration = 30;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string; login: string }> }
) {
  const { owner, repo, login } = await params;

  const url = new URL(request.url);
  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `${url.protocol}//${url.host}`;
  const renderUrl = `${origin}/card-render/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(login)}`;

  let browser;
  try {
    console.log('Launching browser...');
    const execPath = await chromium.executablePath();
    console.log('Chromium path:', execPath);

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: {
        width: 800,
        height: 600,
        deviceScaleFactor: 2,
      },
      executablePath: execPath,
      headless: true,
    });

    console.log('Navigating to:', renderUrl);
    const page = await browser.newPage();

    const response = await page.goto(renderUrl, {
      waitUntil: 'networkidle0',
      timeout: 15000,
    });

    if (!response || response.status() === 404) {
      return new Response('Card not found', { status: 404 });
    }

    console.log('Page loaded, status:', response.status());

    await page.waitForSelector('[data-ready]', { timeout: 10000 });

    const cardElement = await page.$('#card-wrapper');
    if (!cardElement) {
      return new Response('Card element not found', { status: 500 });
    }

    const screenshot = await cardElement.screenshot({
      type: 'png',
      omitBackground: true,
    });

    console.log('Screenshot taken, size:', screenshot.length);

    const buffer = Buffer.from(screenshot);
    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (error: any) {
    console.error('Card screenshot error:', error?.message || error);
    console.error('Stack:', error?.stack);
    return new Response(`Failed to generate card image: ${error?.message || 'Unknown error'}`, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
