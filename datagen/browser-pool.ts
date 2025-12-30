/**
 * Browser pool management for parallel simulation execution
 */

import puppeteer, { Browser, Page } from "puppeteer";
import { BrowserPoolConfig } from "./types.js";

export class BrowserPool {
  private config: BrowserPoolConfig;
  private browsers: Browser[] = [];
  private availablePages: Page[] = [];
  private busyPages: Set<Page> = new Set();
  private simCountPerBrowser: Map<Browser, number> = new Map();
  private isShuttingDown = false;

  constructor(config: BrowserPoolConfig) {
    this.config = config;
  }

  /**
   * Initialize the browser pool
   */
  async initialize(): Promise<void> {
    console.log(`Initializing browser pool with ${this.config.poolSize} instances...`);

    for (let i = 0; i < this.config.poolSize; i++) {
      const browser = await this.launchBrowser();
      this.browsers.push(browser);
      this.simCountPerBrowser.set(browser, 0);

      const page = await this.createPage(browser);
      this.availablePages.push(page);
    }

    console.log(`Browser pool initialized with ${this.availablePages.length} pages`);
  }

  /**
   * Launch a new browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    // Determine GL backend based on config or environment
    // For headless/WSL/HPC environments, use SwiftShader (software WebGL)
    const useSwiftShader = this.config.useSwiftShader ?? true;

    const glArgs = useSwiftShader
      ? [
          "--use-gl=angle",
          "--use-angle=swiftshader-webgl",
          "--enable-unsafe-swiftshader",
        ]
      : [
          "--use-gl=egl", // Use EGL for GPU rendering (requires GPU)
        ];

    return puppeteer.launch({
      headless: this.config.headless,
      args: [
        ...glArgs,
        "--enable-webgl",
        "--enable-webgl2",
        "--disable-web-security", // Allow file:// access
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu-sandbox",
        `--window-size=${this.config.width},${this.config.height}`,
      ],
      defaultViewport: {
        width: this.config.width,
        height: this.config.height,
      },
    });
  }

  /**
   * Create a new page in the given browser
   */
  private async createPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();

    // Set viewport
    await page.setViewport({
      width: this.config.width,
      height: this.config.height,
      deviceScaleFactor: 1,
    });

    // Expose console logs from the page
    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error" || type === "warn") {
        console.log(`[Page ${type}] ${msg.text()}`);
      }
    });

    // Handle page errors
    page.on("pageerror", (err) => {
      console.error(`[Page error] ${err.message}`);
    });

    return page;
  }

  /**
   * Acquire a page from the pool
   */
  async acquirePage(): Promise<Page> {
    while (this.availablePages.length === 0 && !this.isShuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.isShuttingDown) {
      throw new Error("Browser pool is shutting down");
    }

    const page = this.availablePages.pop()!;
    this.busyPages.add(page);
    return page;
  }

  /**
   * Release a page back to the pool
   */
  async releasePage(page: Page): Promise<void> {
    this.busyPages.delete(page);

    const browser = page.browser();
    const count = (this.simCountPerBrowser.get(browser) || 0) + 1;
    this.simCountPerBrowser.set(browser, count);

    // Check if browser needs restart (to prevent memory leaks)
    const maxSims = this.config.maxSimsPerBrowser || 50;
    if (count >= maxSims) {
      console.log(`Browser reached ${count} simulations, restarting...`);
      await this.restartBrowser(browser, page);
    } else {
      // Navigate away to clear state, then add back to pool
      try {
        await page.goto("about:blank");
        this.availablePages.push(page);
      } catch (err) {
        // Page might be closed, create a new one
        console.warn("Failed to reset page, creating new one");
        const newPage = await this.createPage(browser);
        this.availablePages.push(newPage);
      }
    }
  }

  /**
   * Restart a browser and replace its page in the pool
   */
  private async restartBrowser(oldBrowser: Browser, oldPage: Page): Promise<void> {
    // Remove old browser
    const index = this.browsers.indexOf(oldBrowser);
    if (index > -1) {
      this.browsers.splice(index, 1);
    }
    this.simCountPerBrowser.delete(oldBrowser);

    try {
      await oldPage.close();
    } catch (e) {
      // Ignore
    }

    try {
      await oldBrowser.close();
    } catch (e) {
      // Ignore
    }

    // Create new browser
    const newBrowser = await this.launchBrowser();
    this.browsers.push(newBrowser);
    this.simCountPerBrowser.set(newBrowser, 0);

    const newPage = await this.createPage(newBrowser);
    this.availablePages.push(newPage);
  }

  /**
   * Get the HTML file path for navigation
   */
  getHtmlPath(): string {
    return this.config.htmlPath;
  }

  /**
   * Shutdown the browser pool
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    console.log("Shutting down browser pool...");

    // Wait for busy pages to be released
    const timeout = 30000;
    const start = Date.now();
    while (this.busyPages.size > 0 && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Close all browsers
    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore errors during shutdown
      }
    }

    this.browsers = [];
    this.availablePages = [];
    this.busyPages.clear();
    console.log("Browser pool shutdown complete");
  }

  /**
   * Get pool statistics
   */
  getStats(): { total: number; available: number; busy: number } {
    return {
      total: this.browsers.length,
      available: this.availablePages.length,
      busy: this.busyPages.size,
    };
  }
}
