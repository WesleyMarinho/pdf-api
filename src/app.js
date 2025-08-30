/**
 * PDF Generation API Application
 * Main application file with routes and middleware
 */

const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const config = require('./config/environment');

const app = express();

// Trust proxy for correct host/protocol detection behind reverse proxies
// This is crucial for generating correct download URLs.
app.set('trust proxy', true);

// --- CONFIGURATION --- 
const OUTPUT_DIR = path.join(__dirname, '..', 'generated-pdfs');

// Use configuration from environment module
const {
    API_KEY,
    PUPPETEER_TIMEOUT,
    PDF_GENERATION_TIMEOUT,
    FILE_EXPIRATION_MS,
    CLEANUP_INTERVAL_MS
} = config;

// Logging System
const logOperation = (type, message, details = {}) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        type,
        message,
        ...details
    };
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`, details.error ? `- Error: ${details.error}` : '');
};

// --- INITIALIZATION ---
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const cleanupOldFiles = () => {
    fs.readdir(OUTPUT_DIR, (err, files) => {
        if (err) {
            logOperation('cleanup_error', 'Error reading PDF directory for cleanup', { error: err.message });
            return;
        }
        
        let deletedCount = 0;
        let totalFiles = files.length;
        
        if (totalFiles === 0) {
            logOperation('cleanup', 'No files to clean up');
            return;
        }
        
        for (const file of files) {
            const filePath = path.join(OUTPUT_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    logOperation('cleanup_error', `Error getting stats for file ${file}`, { error: err.message });
                    return;
                }
                if (Date.now() - stats.mtime.getTime() > FILE_EXPIRATION_MS) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            logOperation('cleanup_error', `Failed to delete expired file: ${file}`, { error: err.message });
                        } else {
                            deletedCount++;
                            logOperation('cleanup', `Deleted expired file: ${file}`, { 
                                fileAge: Math.round((Date.now() - stats.mtime.getTime()) / 1000 / 60) + ' minutes',
                                deletedCount,
                                totalFiles
                            });
                        }
                    });
                }
            });
        }
    });
};

setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS);

// --- MIDDLEWARES ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTPS enforcement middleware
app.use((req, res, next) => {
    const protocol = req.protocol;
    const host = req.get('host');

    // In production, if the request is not secure, redirect to HTTPS
    if (protocol !== 'https' && process.env.NODE_ENV === 'production') {
        return res.redirect(301, `https://${host}${req.url}`);
    }
    
    next();
});

// Global security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-Download-Options', 'noopen');
    
    // HTTPS Strict Transport Security (HSTS) - only send if connection is secure
    if (req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    next();
});

const apiKeyAuth = (req, res, next) => {
    if (!API_KEY) {
        console.error('CRITICAL: API_KEY is not defined in environment variables.');
        return res.status(500).json({ success: false, error: 'Server configuration error.' });
    }
    const providedKey = req.header('X-API-KEY');
    if (providedKey && providedKey === API_KEY) {
        return next();
    }
    res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API Key' });
};

// --- AUXILIARY FUNCTIONS ---

/**
 * Formats remaining time into a readable string
 * @param {number} timeRemainingMs - Time remaining in milliseconds
 * @returns {string} - Formatted time (e.g., "45 minutes", "2 hours")
 */
function formatTimeRemaining(timeRemainingMs) {
    if (timeRemainingMs <= 0) return 'Expired';
    
    const hours = Math.floor(timeRemainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
}

/**
 * Waits for all images to be completely loaded
 * @param {import('puppeteer').Page} page
 */
async function waitForImagesLoad(page) {
    console.log('Waiting for complete image loading...');
    
    await page.evaluate(() => {
        return new Promise((resolve) => {
            const images = Array.from(document.querySelectorAll('img'));
            if (images.length === 0) {
                resolve();
                return;
            }

            let loadedImages = 0;
            const totalImages = images.length;
            
            console.log(`Total images found: ${totalImages}`);

            const checkComplete = () => {
                loadedImages++;
                console.log(`Image loaded: ${loadedImages}/${totalImages}`);
                
                if (loadedImages === totalImages) {
                    console.log('All images have been loaded');
                    resolve();
                }
            };

            images.forEach((img, index) => {
                if (img.complete && img.naturalWidth > 0) {
                    console.log(`Image ${index + 1} already loaded: ${img.src}`);
                    checkComplete();
                } else {
                    console.log(`Waiting for image ${index + 1} to load: ${img.src}`);
                    
                    const onLoad = () => {
                        console.log(`Image ${index + 1} loaded successfully`);
                        img.removeEventListener('load', onLoad);
                        img.removeEventListener('error', onError);
                        checkComplete();
                    };

                    const onError = () => {
                        console.warn(`Failed to load image ${index + 1}: ${img.src}`);
                        img.removeEventListener('load', onLoad);
                        img.removeEventListener('error', onError);
                        checkComplete(); // Count as loaded even with error
                    };

                    img.addEventListener('load', onLoad);
                    img.addEventListener('error', onError);

                    // Force reload if necessary
                    if (img.src) {
                        const currentSrc = img.src;
                        img.src = '';
                        img.src = currentSrc;
                    }
                }
            });

            // Safety timeout
            setTimeout(() => {
                console.log('Image loading timeout, continuing...');
                resolve();
            }, 15000);
        });
    });
}

/**
 * Waits for all critical elements to be loaded
 * @param {import('puppeteer').Page} page
 */
async function waitForContentLoad(page) {
    try {
        await page.waitForLoadState?.('networkidle') || new Promise(resolve => setTimeout(resolve, 2000));
        await waitForImagesLoad(page);

        console.log('Waiting for fonts to load...');
        await Promise.race([
            page.evaluateHandle(() => document.fonts.ready),
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);

        console.log('Waiting for ApexCharts to load...');
        await page.waitForFunction(
            () => typeof window.ApexCharts !== 'undefined',
            { timeout: 10000 }
        ).catch(() => console.log('ApexCharts not found, continuing...'));

        console.log('Forcing chart initialization...');
        await page.evaluate(() => {
            if (window.Reports && typeof window.Reports.init === 'function') {
                try { window.Reports.init(); } catch (e) { console.error('Error in Reports initialization:', e); }
            }
            if (window.ApexCharts && window.Reports) {
                setTimeout(() => {
                    try {
                        window.Reports.initializeAllCharts();
                        window.Reports.initializeMiniCharts();
                    } catch (e) { console.error('Error in re-initialization:', e); }
                }, 1000);
            }
        });

        console.log('Waiting for chart rendering...');
        await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
        console.log('Error waiting for content loading:', error.message);
    }
}

// --- API ROUTES ---

app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url, options = {}, landscape } = req.body;
    const startTime = Date.now();
    const requestId = crypto.randomBytes(8).toString('hex');

    logOperation('pdf_request', 'PDF generation request received', {
        requestId, url, userAgent: req.get('User-Agent'), ip: req.ip
    });

    if (!url) {
        logOperation('pdf_error', 'Missing URL parameter', { requestId });
        return res.status(400).json({ success: false, error: 'The "url" property is required in the JSON body.' });
    }
    try {
        new URL(url);
    } catch (_) {
        logOperation('pdf_error', 'Invalid URL format', { requestId, url });
        return res.status(400).json({ success: false, error: 'Invalid URL format provided.' });
    }

    let browser = null;
    try {
        const filename = `${crypto.randomBytes(20).toString('hex')}.pdf`;
        const outputPath = path.join(OUTPUT_DIR, filename);

        browser = await puppeteer.launch({
            headless: "new",
            timeout: PUPPETEER_TIMEOUT,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-web-security', '--disable-features=VizDisplayCompositor',
                '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding', '--font-render-hinting=medium',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--disable-gpu',
                '--disable-lazy-loading', '--disable-background-media-suspend',
                '--autoplay-policy=no-user-gesture-required'
            ]
        });
        
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();
            const blockedResources = ['websocket', 'manifest'];
            const blockedUrls = ['/ads/', 'google-analytics', 'googletagmanager', 'facebook.com/tr', 'doubleclick.net'];
            if (blockedResources.includes(resourceType) || blockedUrls.some(blocked => url.includes(blocked))) {
                req.abort();
            } else {
                req.continue();
            }
        });

        page.on('console', msg => {
            if (msg.type() === 'error') logOperation('browser_error', `Browser console error: ${msg.text()}`, { requestId });
        });

        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto(url, { waitUntil: ['networkidle0', 'domcontentloaded'], timeout: PUPPETEER_TIMEOUT });
        await page.emulateMediaType('screen');
        await waitForContentLoad(page);
        
        await page.addStyleTag({ content: `
            img { max-width: 100% !important; height: auto !important; display: block !important; }
            [loading="lazy"] { loading: eager !important; }`
        });

        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const isLandscape = typeof landscape === 'boolean' ? landscape : true;
        await page.pdf({
            path: outputPath,
            format: options.format || 'A4',
            landscape: isLandscape,
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            scale: 0.9,
            timeout: PDF_GENERATION_TIMEOUT,
            preferCSSPageSize: true,
            displayHeaderFooter: false
        });
        
        const duration = Date.now() - startTime;
        logOperation('pdf_generation_success', `PDF generated: ${filename}`, { requestId, duration: `${duration}ms` });
        
        const protocol = req.protocol;
        const host = req.get('host');
        const downloadUrl = `${protocol}://${host}/download/${filename}`;

        res.status(200).json({ 
            success: true, 
            downloadUrl: downloadUrl, 
            expiresIn: '1 hour',
            filename: filename
        });

    } catch (error) {
        logOperation('pdf_generation_error', `PDF generation failed: ${error.message}`, { requestId, errorStack: error.stack });
        res.status(500).json({ success: false, error: 'Failed to generate PDF.', details: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    
    if (!filename || filename.includes('..') || !/^[a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    
    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }
    
    try {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        // Other security headers are already set globally
        
        const stats = fs.statSync(filePath);
        res.setHeader('Content-Length', stats.size);
        
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
    } catch (error) {
        logOperation('download_error', `Error processing download for ${filename}: ${error.message}`, { errorStack: error.stack });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error processing download.' });
        }
    }
});

app.get('/files', apiKeyAuth, (req, res) => {
    try {
        const files = fs.readdirSync(OUTPUT_DIR);
        const protocol = req.protocol;
        const host = req.get('host');

        const fileInfos = files.map(filename => {
            const filePath = path.join(OUTPUT_DIR, filename);
            const stats = fs.statSync(filePath);
            const createdAt = stats.mtime;
            const expiresAt = new Date(createdAt.getTime() + FILE_EXPIRATION_MS);
            const timeRemaining = expiresAt.getTime() - Date.now();
            
            return {
                filename: filename,
                createdAt: createdAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                status: timeRemaining <= 0 ? 'expired' : 'active',
                downloadUrl: `${protocol}://${host}/download/${filename}`,
                timeRemaining: formatTimeRemaining(timeRemaining)
            };
        });

        res.json({
            success: true,
            files: fileInfos,
            totalFiles: fileInfos.length,
            activeFiles: fileInfos.filter(f => f.status === 'active').length,
            expiredFiles: fileInfos.filter(f => f.status === 'expired').length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to list files', details: error.message });
    }
});

app.get('/view/:filename', (req, res) => {
    const { filename } = req.params;
    
    if (!filename || filename.includes('..') || !/^[a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    
    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }
    
    try {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Allow embedding on same origin
        
        const stats = fs.statSync(filePath);
        res.setHeader('Content-Length', stats.size);
        
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error processing file view.' });
        }
    }
});

app.get('/status', (req, res) => {
    const versionInfo = config.getVersionInfo();
    res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        ...versionInfo,
        environment: config.NODE_ENV,
        uptime: process.uptime()
    });
});

app.post('/debug-page', apiKeyAuth, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-gpu'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1600, height: 1000 });
        await page.goto(url, { waitUntil: 'networkidle0' });
        
        const debugInfo = await page.evaluate(() => ({
            images: {
                total: document.querySelectorAll('img').length,
                loaded: Array.from(document.querySelectorAll('img')).filter(img => img.complete && img.naturalWidth > 0).length
            },
            charts: {
                total: document.querySelectorAll('.apexcharts-canvas').length,
                rendered: Array.from(document.querySelectorAll('.apexcharts-canvas')).filter(c => c.querySelector('svg g.apexcharts-series path')).length
            }
        }));
        res.json({ success: true, url, debugInfo, timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ error: 'Debug error', details: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// Export the app for use by server.js
module.exports = app;
