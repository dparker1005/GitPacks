import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';

export const maxDuration = 30;

// Hosted Chromium binary compatible with @sparticuz/chromium-min
const CHROMIUM_URL = 'https://github.com/nichochar/chromium-binaryies/releases/download/chromium-v131.0.1/chromium-v131.0.1-pack.tar';

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
    const execPath = await chromium.executablePath(CHROMIUM_URL);

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

    const page = await browser.newPage();

    const response = await page.goto(renderUrl, {
      waitUntil: 'networkidle0',
      timeout: 15000,
    });

    if (!response || response.status() === 404) {
      return new Response('Card not found', { status: 404 });
    }

    await page.waitForSelector('[data-ready]', { timeout: 10000 });

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
