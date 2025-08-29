// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const app = express();

// --- CONFIGURATION --- 
const port = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const OUTPUT_DIR = path.join(__dirname, 'generated_pdfs');
const FILE_EXPIRATION_HOURS = process.env.FILE_EXPIRATION_HOURS || 1;
const FILE_EXPIRATION_MS = FILE_EXPIRATION_HOURS * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 900000; // 15 minutos

// --- INITIALIZATION ---
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const cleanupOldFiles = () => {
    fs.readdir(OUTPUT_DIR, (err, files) => {
        if (err) {
            console.error("Error reading PDF directory for cleanup:", err);
            return;
        }
        for (const file of files) {
            const filePath = path.join(OUTPUT_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error(`Error getting stats for file ${file}:`, err);
                    return;
                }
                if (Date.now() - stats.mtime.getTime() > FILE_EXPIRATION_MS) {
                    fs.unlink(filePath, (err) => {
                        if (err) console.error(`Failed to delete expired file: ${file}`, err);
                        else console.log(`Deleted expired file: ${file}`);
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
    // Force HTTPS in production
    if (req.header('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
        return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    
    // Force HTTPS for all environments if not localhost
    if (!req.secure && req.get('host') !== 'localhost:3000' && req.get('host') !== '127.0.0.1:3000') {
        return res.redirect(301, `https://${req.get('host')}${req.url}`);
    }
    
    next();
});

// Global security middleware
app.use((req, res, next) => {
    // Basic security headers for all responses
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-Download-Options', 'noopen');
    
    // HTTPS Strict Transport Security (HSTS)
    if (req.secure || req.header('x-forwarded-proto') === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    // CORS headers para permitir acesso de qualquer origem
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    
    // For OPTIONS requests (preflight)
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
 * Aguarda que todas as imagens sejam carregadas completamente
 * @param {import('puppeteer').Page} page
 */
async function waitForImagesLoad(page) {
    console.log('Aguardando carregamento completo das imagens...');
    
    await page.evaluate(() => {
        return new Promise((resolve) => {
            const images = Array.from(document.querySelectorAll('img'));
            if (images.length === 0) {
                resolve();
                return;
            }

            let loadedImages = 0;
            const totalImages = images.length;
            
            console.log(`Total de imagens encontradas: ${totalImages}`);

            const checkComplete = () => {
                loadedImages++;
                console.log(`Imagem carregada: ${loadedImages}/${totalImages}`);
                
                if (loadedImages === totalImages) {
                    console.log('Todas as imagens foram carregadas');
                    resolve();
                }
            };

            images.forEach((img, index) => {
                if (img.complete && img.naturalWidth > 0) {
                    console.log(`Image ${index + 1} already loaded: ${img.src}`);
                    checkComplete();
                } else {
                    console.log(`Aguardando carregamento da imagem ${index + 1}: ${img.src}`);
                    
                    const onLoad = () => {
                        console.log(`Imagem ${index + 1} carregou com sucesso`);
                        img.removeEventListener('load', onLoad);
                        img.removeEventListener('error', onError);
                        checkComplete();
                    };

                    const onError = () => {
                        console.warn(`Falha ao carregar imagem ${index + 1}: ${img.src}`);
                        img.removeEventListener('load', onLoad);
                        img.removeEventListener('error', onError);
                        checkComplete(); // Conta como carregada mesmo com erro
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

        // Aguarda imagens carregarem
        await waitForImagesLoad(page);

        console.log('Aguardando carregamento de fontes...');
        await Promise.race([
            page.evaluateHandle(() => document.fonts.ready),
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);

        console.log('Aguardando carregamento do ApexCharts...');
        await page.waitForFunction(
            () => typeof window.ApexCharts !== 'undefined',
            { timeout: 10000 }
        ).catch(() => console.log('ApexCharts not found, continuing...'));

        console.log('Forcing chart initialization...');
        await page.evaluate(() => {
            if (window.Reports && typeof window.Reports.init === 'function') {
                console.log('Inicializando via Reports.init()');
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

// --- ROTAS DA API ---

app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url, options = {}, landscape } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, error: 'The "url" property is required in the JSON body.' });
    }
    try {
        new URL(url);
    } catch (_) {
        return res.status(400).json({ success: false, error: 'Invalid URL format provided.' });
    }

    let browser = null;
    try {
        const filename = `${crypto.randomBytes(20).toString('hex')}.pdf`;
        const outputPath = path.join(OUTPUT_DIR, filename);

        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-web-security', 
                '--disable-features=VizDisplayCompositor',
                '--disable-background-timer-throttling', 
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding', 
                '--font-render-hinting=medium',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-gpu',
                // Specific parameters for better image loading
                '--disable-lazy-loading',
                '--disable-background-media-suspend',
                '--autoplay-policy=no-user-gesture-required'
            ]
        });
        
        const page = await browser.newPage();

        // Intercept only unnecessary resources (keep images)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();
            
            // Block only truly unnecessary resources
            if (resourceType === 'websocket' || 
                resourceType === 'manifest' ||
                url.includes('/ads/') ||
                url.includes('google-analytics') ||
                url.includes('googletagmanager') ||
                url.includes('facebook.com/tr') ||
                url.includes('doubleclick.net')) {
                req.abort();
            } else {
                // Permite imagens e outros recursos importantes
                req.continue();
            }
        });

        // Captura logs para debug
        page.on('console', msg => {
            const type = msg.type();
            if (type === 'error') {
                console.error(`[Browser Console ERROR]: ${msg.text()}`);
            } else if (type === 'log' && msg.text().includes('Imagem')) {
                console.log(`[Browser Image LOG]: ${msg.text()}`);
            }
        });

        // Configura viewport e user agent
        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log(`Navegando para: ${url}`);
        await page.goto(url, { 
            waitUntil: ['networkidle0', 'domcontentloaded'], 
            timeout: 120000 
        });
        
        console.log('Page loaded, processing content...');

        // Force screen CSS
        await page.emulateMediaType('screen');

        // Wait for complete content loading
        await Promise.race([
            waitForContentLoad(page),
            new Promise(resolve => setTimeout(resolve, 25000))
        ]);
        
        console.log('Applying final CSS corrections...');
        await page.addStyleTag({
            content: `
                /* Correções finais para PDF */
                .apexcharts-canvas, svg.apexcharts-svg {
                    max-width: 750px !important;
                    width: 100% !important;
                    overflow: hidden !important;
                }
                
                .chart-container {
                    max-width: 750px !important;
                    width: 100% !important;
                    margin: 0 auto !important;
                    overflow: hidden !important;
                    box-sizing: border-box !important;
                }
                
                /* Garante que imagens sejam exibidas corretamente */
                img {
                    max-width: 100% !important;
                    height: auto !important;
                    display: block !important;
                }
                
                .post-thumbnail img,
                .profile-avatar-large img,
                .post-card-img {
                    object-fit: cover !important;
                    width: 100% !important;
                    height: 100% !important;
                }
                
                /* Força exibição de imagens que podem estar ocultas */
                [loading="lazy"] {
                    loading: eager !important;
                }
            `
        });

        // Force final adjustments
        await page.evaluate(() => {
            // Force lazy image display
            document.querySelectorAll('img[loading="lazy"]').forEach(img => {
                img.loading = 'eager';
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                }
            });

            // Adjust charts
            const charts = document.querySelectorAll('.apexcharts-canvas');
            charts.forEach(chart => {
                const svg = chart.querySelector('svg');
                if (svg) {
                    svg.style.maxWidth = '100%';
                    svg.style.width = '100%';
                    svg.style.height = 'auto';
                }
            });

            if (window.Reports && typeof window.Reports.forceChartResize === 'function') {
                try {
                    window.Reports.forceChartResize();
                } catch (e) {
                    console.error('Erro no forceChartResize:', e);
                }
            }
        });

        console.log('Waiting for final stabilization...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('Gerando PDF...');
        
        const isLandscape = typeof landscape === 'boolean' ? landscape : true;
        console.log(`Orientation mode: ${isLandscape ? 'Landscape' : 'Portrait'}`);

        const pdfOptions = {
            path: outputPath,
            format: options.format || 'A4',
            landscape: isLandscape,
            printBackground: true,
            margin: { 
                top: '10mm', 
                right: '10mm', 
                bottom: '10mm', 
                left: '10mm' 
            },
            scale: 0.9,
            timeout: 90000, // Timeout maior para imagens
            preferCSSPageSize: true,
            displayHeaderFooter: false
        };

        await page.pdf(pdfOptions);
        
        console.log(`PDF gerado com sucesso: ${filename}`);
        
        const downloadUrl = `${req.protocol}://${req.get('host')}/download/${filename}`;
        res.status(200).json({ 
            success: true, 
            downloadUrl: downloadUrl, 
            expiresIn: '1 hour',
            filename: filename
        });

    } catch (error) {
        console.error('PDF Generation Error:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to generate PDF.', 
            details: error.message 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    
    // Strict filename validation
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') || !/^[a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    
    const filePath = path.join(OUTPUT_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }
    
    try {
        // Configure security headers for download without warnings
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Security-Policy', "default-src 'none'; object-src 'none'; script-src 'none';");
        res.setHeader('X-Download-Options', 'noopen');
        res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Verificar o tamanho do arquivo
        const stats = fs.statSync(filePath);
        res.setHeader('Content-Length', stats.size);
        
        console.log(`Iniciando download seguro do arquivo: ${filename} (${stats.size} bytes)`);
        
        // Usar stream para download mais eficiente
        const fileStream = fs.createReadStream(filePath);
        
        fileStream.on('error', (err) => {
            console.error(`Erro ao ler arquivo ${filename}:`, err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file.' });
            }
        });
        
        fileStream.on('end', () => {
            console.log(`Download completed successfully: ${filename}`);
        });
        
        // Pipe do arquivo para a resposta
        fileStream.pipe(res);
        
    } catch (error) {
        console.error(`Erro no download do arquivo ${filename}:`, error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error processing download.' });
        }
    }
});

app.get('/files', apiKeyAuth, (req, res) => {
    try {
        const files = fs.readdirSync(OUTPUT_DIR);
        const fileInfos = files.map(filename => {
            const filePath = path.join(OUTPUT_DIR, filename);
            const stats = fs.statSync(filePath);
            const createdAt = stats.mtime;
            const expiresAt = new Date(createdAt.getTime() + FILE_EXPIRATION_MS);
            const timeRemaining = expiresAt.getTime() - Date.now();
            const isExpired = timeRemaining <= 0;
            
            return {
                filename: filename,
                createdAt: createdAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                status: isExpired ? 'expired' : 'active',
                downloadUrl: `${req.protocol}://${req.get('host')}/download/${filename}`,
                timeRemaining: formatTimeRemaining(timeRemaining)
            };
        });

        const activeFiles = fileInfos.filter(file => file.status === 'active');
        const expiredFiles = fileInfos.filter(file => file.status === 'expired');

        res.json({
            success: true,
            files: fileInfos,
            totalFiles: fileInfos.length,
            activeFiles: activeFiles.length,
            expiredFiles: expiredFiles.length,
            expirationSettings: {
                expirationHours: FILE_EXPIRATION_HOURS,
                cleanupIntervalMinutes: CLEANUP_INTERVAL_MS / (1000 * 60)
            }
        });
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list files',
            details: error.message
        });
    }
});

// Endpoint for inline PDF viewing (without forcing download)
app.get('/view/:filename', (req, res) => {
    const { filename } = req.params;
    
    // Strict filename validation
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') || !/^[a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    
    const filePath = path.join(OUTPUT_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }
    
    try {
        // Configure headers for inline viewing
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
        
        // Verificar o tamanho do arquivo
        const stats = fs.statSync(filePath);
        res.setHeader('Content-Length', stats.size);
        
        console.log(`Starting inline viewing of file: ${filename} (${stats.size} bytes)`);
        
        // Usar stream para envio mais eficiente
        const fileStream = fs.createReadStream(filePath);
        
        fileStream.on('error', (err) => {
            console.error(`Erro ao ler arquivo ${filename}:`, err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file.' });
            }
        });
        
        fileStream.on('end', () => {
            console.log(`Inline viewing completed successfully: ${filename}`);
        });
        
        // Pipe do arquivo para a resposta
        fileStream.pipe(res);
        
    } catch (error) {
        console.error(`Error viewing file ${filename}:`, error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error processing file view.' });
        }
    }
});

app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        version: '1.4.0',
        features: ['Image Loading', 'Chart Rendering', 'PDF Generation', 'Secure Downloads', 'Inline Viewing'],
        endpoints: {
            'POST /generate-pdf': 'Generate PDF with images and charts',
            'POST /debug-page': 'Page debugging',
            'GET /download/:filename': 'Secure PDF download (force download)',
            'GET /view/:filename': 'Inline PDF viewing (open in browser)',
            'GET /files': 'List available files and expiration times',
            'GET /status': 'API Status'
        },
        security: {
            'download_headers': 'Security headers configured',
            'filename_validation': 'Strict filename validation',
            'stream_based': 'Stream-based download for efficiency'
        }
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
        res.status(500).json({ error: 'Erro no debug', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`PDF Generation API v1.3.0 running on port ${port}`);
    console.log(`Melhorias: Carregamento de imagens otimizado`);
    console.log(`Status endpoint: http://localhost:${port}/status`);
});
