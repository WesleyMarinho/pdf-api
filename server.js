require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const OUTPUT_DIR = path.join(__dirname, 'generated_pdfs');
const FILE_EXPIRATION_MS = 3600000;

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ... (a função de limpeza e os middlewares permanecem os mesmos)
const cleanupOldFiles = () => { /* ... */ };
setInterval(cleanupOldFiles, 900000);
app.use(express.json({ limit: '10mb' }));
const apiKeyAuth = (req, res, next) => { /* ... */ };


// Endpoint principal para gerar o PDF
app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url } = req.body;

    if (!url) { /* ... (validação de URL) */ }

    let browser = null;
    try {
        const filename = `${crypto.randomBytes(20).toString('hex')}.pdf`;
        const outputPath = path.join(OUTPUT_DIR, filename);

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 }); // Viewport de desktop grande

        // =========================================================================
        // CORREÇÕES PRINCIPAIS AQUI
        // =========================================================================
        
        // Navega para a página. 'domcontentloaded' é mais rápido para começar.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

        // INJEÇÃO DE CSS: Força a desativação de todas as animações e transições.
        // Isso faz com que os elementos apareçam em seu estado final imediatamente.
        await page.addStyleTag({
            content: `
              *,
              *::before,
              *::after {
                animation-delay: -1ms !important;
                animation-duration: 1ms !important;
                animation-iteration-count: 1 !important;
                background-attachment: initial !important;
                scroll-behavior: auto !important;
                transition-delay: 0s !important;
                transition-duration: 0s !important;
              }
            `
        });
        
        // ESPERA ADICIONAL: Dá um tempo fixo para scripts de "lazy loading"
        // e outras lógicas assíncronas terminarem. 2-3 segundos é um bom valor.
        await new Promise(resolve => setTimeout(resolve, 3000)); // Espera 3 segundos

        // =========================================================================

        await page.emulateMediaType('print');
        
        await page.pdf({
            path: outputPath,
            format: 'A4',
            printBackground: true,
            fullPage: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        
        const downloadUrl = `${req.protocol}://${req.get('host')}/download/${filename}`;
        
        res.status(200).json({
            success: true,
            downloadUrl: downloadUrl,
            expiresIn: '1 hour'
        });

    } catch (error) {
        // ... (bloco catch)
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// ... (endpoint de download e app.listen permanecem os mesmos)
app.get('/download/:filename', (req, res) => { /* ... */ });
app.listen(port, () => { /* ... */ });
