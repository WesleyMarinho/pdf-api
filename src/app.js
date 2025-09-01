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

app.set('trust proxy', true); // Mantemos isso por boas práticas, mas não dependeremos mais dele para a URL.

// --- CONFIGURATION --- 
const OUTPUT_DIR = path.join(__dirname, '..', 'generated-pdfs');

// Use configuration from environment module
const {
    API_KEY,
    PUBLIC_BASE_URL, // <<< CARREGAMOS A NOVA VARIÁVEL
    PUPPETEER_TIMEOUT,
    PDF_GENERATION_TIMEOUT,
    FILE_EXPIRATION_MS,
    CLEANUP_INTERVAL_MS
} = config;

// Validação crítica: A aplicação não pode funcionar sem a URL base.
if (!PUBLIC_BASE_URL) {
    console.error('CRITICAL: PUBLIC_BASE_URL is not defined in environment variables. Exiting.');
    process.exit(1);
}

// Logging System
const logOperation = (type, message, details = {}) => {
    const timestamp = new Date().toISOString();
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
        files.forEach(file => {
            const filePath = path.join(OUTPUT_DIR, file);
            fs.stat(filePath, (statErr, stats) => {
                if (statErr) return;
                if (Date.now() - stats.mtime.getTime() > FILE_EXPIRATION_MS) {
                    fs.unlink(filePath, (unlinkErr) => {
                        if (unlinkErr) {
                            logOperation('cleanup_error', `Failed to delete expired file: ${file}`, { error: unlinkErr.message });
                        } else {
                            logOperation('cleanup', `Deleted expired file: ${file}`);
                        }
                    });
                }
            });
        });
    });
};

setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS);

// --- MIDDLEWARES ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

const apiKeyAuth = (req, res, next) => {
    if (!API_KEY) {
        console.error('CRITICAL: API_KEY is not defined.');
        return res.status(500).json({ success: false, error: 'Server configuration error.' });
    }
    if (req.header('X-API-KEY') === API_KEY) {
        return next();
    }
    res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API Key' });
};

/**
 * Formata o tempo restante em formato legível
 * @param {number} timeRemainingMs - Tempo restante em milissegundos
 * @returns {string} - Tempo formatado (ex: "45 minutes", "2 hours")
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
 * Aguarda que todos os elementos críticos sejam carregados
 * @param {import('puppeteer').Page} page
 */
async function waitForContentLoad(page) {
    try {
        // Wait for basic page loading
        await page.waitForLoadState?.('networkidle') || new Promise(resolve => setTimeout(resolve, 2000));

        // Wait for images to load
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
                console.log('Initializing via Reports.init()');
                try {
                    window.Reports.init();
                } catch (e) {
                    console.error('Error in Reports initialization:', e);
                }
            }

            if (window.ApexCharts) {
                console.log('Configurando Apex global');
                window.Apex = {
                    chart: {
                        width: '100%',
                        maxWidth: 750,
                        parentHeightOffset: 0,
                        redrawOnParentResize: false,
                        redrawOnWindowResize: false,
                        animations: { enabled: false },
                        toolbar: { show: false },
                        zoom: { enabled: false }
                    },
                    responsive: [{
                        breakpoint: 1600,
                        options: {
                            chart: {
                                width: '100%',
                                maxWidth: 750
                            },
                            legend: {
                                position: 'bottom',
                                fontSize: '12px'
                            }
                        }
                    }]
                };
            }

            if (window.ApexCharts && window.Reports) {
                setTimeout(() => {
                    try {
                        window.Reports.initializeAllCharts();
                        window.Reports.initializeMiniCharts();
                    } catch (e) {
                        console.error('Error in re-initialization:', e);
                    }
                }, 1000);
            }
        });

        // Wait for chart rendering
        console.log('Waiting for chart rendering...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Final verification
        const allLoaded = await page.evaluate(() => {
            // Check images
            const images = Array.from(document.querySelectorAll('img'));
            const imagesLoaded = images.every(img => img.complete && img.naturalWidth > 0);
            
            // Check charts
            const charts = document.querySelectorAll('.apexcharts-canvas svg');
            const chartsRendered = charts.length === 0 || Array.from(charts).some(svg => {
                return svg.querySelector('g.apexcharts-series path, g.apexcharts-series rect, g.apexcharts-heatmap-series rect');
            });

            console.log(`Images loaded: ${imagesLoaded}, Charts rendered: ${chartsRendered}`);
            return imagesLoaded && chartsRendered;
        });

        console.log(`Loading completed: ${allLoaded ? 'Success' : 'Partial'}`);

    } catch (error) {
        console.log('Error waiting for content loading:', error.message);
    }
}

// --- API ROUTES ---

app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url, options = {}, landscape, filename: requestedFilename } = req.body;
    const startTime = Date.now();
    const requestId = crypto.randomBytes(8).toString('hex');

    logOperation('pdf_request', 'PDF generation request received', { requestId, url, requestedFilename });

    if (!url) {
        return res.status(400).json({ success: false, error: 'The "url" property is required.' });
    }
    try { new URL(url); } catch (_) {
        return res.status(400).json({ success: false, error: 'Invalid URL format provided.' });
    }

    let browser = null;
    try {
        // Use the requested filename if provided, otherwise generate a random one
        let filename;
        if (requestedFilename) {
            // Sanitize the filename to prevent path traversal and ensure it has .pdf extension
            const sanitizedName = requestedFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
            filename = sanitizedName.endsWith('.pdf') ? sanitizedName : `${sanitizedName}.pdf`;
        } else {
            filename = `${crypto.randomBytes(20).toString('hex')}.pdf`;
        }
        const outputPath = path.join(OUTPUT_DIR, filename);

        // Remove existing file if it exists
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
            logOperation('file_replaced', `Existing file removed: ${filename}`, { filename });
        }

        browser = await puppeteer.launch({
            headless: "new",
            timeout: PUPPETEER_TIMEOUT,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--disable-lazy-loading', '--font-render-hinting=medium'
            ]
        });
        
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0', timeout: PUPPETEER_TIMEOUT });
        await page.emulateMediaType('screen');
        await waitForContentLoad(page);
        
        await page.pdf({
            path: outputPath,
            format: options.format || 'A4',
            landscape: typeof landscape === 'boolean' ? landscape : true,
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            scale: 0.9,
            timeout: PDF_GENERATION_TIMEOUT
        });
        
        logOperation('pdf_generation_success', `PDF generated: ${filename}`, { requestId });
        
        // <<< ALTERAÇÃO PRINCIPAL AQUI >>>
        // Construímos as URLs usando a variável de ambiente, garantindo que estejam sempre corretas.
        const downloadUrl = `${PUBLIC_BASE_URL}/download/${filename}`;
        const viewUrl = `${PUBLIC_BASE_URL}/view/${filename}`;

        res.status(200).json({ 
            success: true, 
            downloadUrl: downloadUrl, // URL de download forçado
            viewUrl: viewUrl,         // URL para visualização no navegador
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
    
    if (!filename || !/^[a-f0-9]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename format.' });
    }
    
    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
});

app.get('/view/:filename', (req, res) => {
    const { filename } = req.params;

    if (!filename || !/^[a-f0-9]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename format.' });
    }

    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }
    
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filePath);
});


app.get('/files', apiKeyAuth, (req, res) => {
    try {
        const files = fs.readdirSync(OUTPUT_DIR);
        
        const fileInfos = files.map(filename => {
            const filePath = path.join(OUTPUT_DIR, filename);
            const stats = fs.statSync(filePath);
            const expiresAt = new Date(stats.mtime.getTime() + FILE_EXPIRATION_MS);
            
            return {
                filename,
                createdAt: stats.mtime.toISOString(),
                expiresAt: expiresAt.toISOString(),
                status: Date.now() > expiresAt.getTime() ? 'expired' : 'active',
                // <<< USA A VARIÁVEL DE AMBIENTE AQUI TAMBÉM >>>
                downloadUrl: `${PUBLIC_BASE_URL}/download/${filename}`,
                viewUrl: `${PUBLIC_BASE_URL}/view/${filename}`
            };
        });

        res.json({ success: true, files: fileInfos });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to list files', details: error.message });
    }
});

app.get('/status', (req, res) => {
    const versionInfo = config.getVersionInfo ? config.getVersionInfo() : { version: "N/A" };
    res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        ...versionInfo,
        environment: config.NODE_ENV
    });
});

app.post('/debug-page', apiKeyAuth, async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
        
        const debugInfo = await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img'));
            const charts = document.querySelectorAll('.apexcharts-canvas');
            
            return {
                images: {
                    total: images.length,
                    loaded: images.filter(img => img.complete && img.naturalWidth > 0).length,
                    failed: images.filter(img => img.complete && img.naturalWidth === 0).length,
                    pending: images.filter(img => !img.complete).length
                },
                charts: {
                    total: charts.length,
                    rendered: Array.from(charts).filter(chart => {
                        return chart.querySelector('svg g.apexcharts-series path, svg g.apexcharts-series rect');
                    }).length
                },
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight
                }
            };
        });

        await browser.close();

        res.json({
            success: true,
            url: url,
            debugInfo: debugInfo,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: 'Debug error', details: error.message });
    }
});

module.exports = app;
