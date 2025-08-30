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

// --- AUXILIARY FUNCTIONS ---
function formatTimeRemaining(timeRemainingMs) { /* ...código inalterado... */ }
async function waitForImagesLoad(page) { /* ...código inalterado... */ }
async function waitForContentLoad(page) { /* ...código inalterado... */ }

// --- API ROUTES ---

app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url, options = {}, landscape } = req.body;
    const startTime = Date.now();
    const requestId = crypto.randomBytes(8).toString('hex');

    logOperation('pdf_request', 'PDF generation request received', { requestId, url });

    if (!url) {
        return res.status(400).json({ success: false, error: 'The "url" property is required.' });
    }
    try { new URL(url); } catch (_) {
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

app.post('/debug-page', apiKeyAuth, async (req, res) => { /* ...código inalterado... */ });

module.exports = app;
