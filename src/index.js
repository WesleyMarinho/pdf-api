// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

// --- CONFIGURAÇÃO ---
const port = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const OUTPUT_DIR = path.join(__dirname, 'generated_pdfs');
const FILE_EXPIRATION_MS = 3600000; // 1 hora
const CLEANUP_INTERVAL_MS = 900000; // 15 minutos

// --- INICIALIZAÇÃO ---
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Função de limpeza automática de PDFs antigos
 */
const cleanupOldFiles = () => {
    fs.readdir(OUTPUT_DIR, (err, files) => {
        if (err) return console.error("Erro ao ler diretório de PDFs:", err);
        for (const file of files) {
            const filePath = path.join(OUTPUT_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return console.error(`Erro ao obter stats do arquivo ${file}:`, err);
                if (Date.now() - stats.mtime.getTime() > FILE_EXPIRATION_MS) {
                    fs.unlink(filePath, (err) => {
                        if (err) console.error(`Erro ao excluir arquivo antigo: ${file}`, err);
                        else console.log(`PDF expirado deletado: ${file}`);
                    });
                }
            });
        }
    });
};
setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS);

// --- MIDDLEWARES ---
app.use(express.json({ limit: '10mb' }));

const apiKeyAuth = (req, res, next) => {
    if (!API_KEY) {
        console.warn('WARNING: API_KEY is not definido. Ignorando autenticação.');
        return next();
    }
    const providedKey = req.header('X-API-KEY');
    if (providedKey && providedKey === API_KEY) return next();
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
};

/**
 * Aguarda imagens, fontes e gráficos carregarem
 */
async function waitForContentLoad(page) {
    try {
        console.log('Aguardando carregamento de imagens...');
        await Promise.race([
            page.evaluate(() => {
                return Promise.all(
                    Array.from(document.images)
                        .filter(img => !img.complete)
                        .map(img => new Promise(resolve => {
                            const timeout = setTimeout(resolve, 3000);
                            img.onload = img.onerror = () => {
                                clearTimeout(timeout);
                                resolve();
                            };
                        }))
                );
            }),
            new Promise(resolve => setTimeout(resolve, 8000))
        ]);

        console.log('Aguardando fontes...');
        await Promise.race([
            page.evaluateHandle(() => document.fonts.ready),
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);

    } catch (error) {
        console.log('Erro ao aguardar carregamento de conteúdo:', error.message);
    }
}

/**
 * Configura página para PDF A4 perfeito
 */
async function configurePageForA4(page) {
    // Define viewport para manter proporção A4
    await page.setViewport({
        width: 1200,
        height: 1697,
        deviceScaleFactor: 2
    });

    // Força CSS de tela, evitando modo print automático
    await page.emulateMediaType('screen');

    // Injeta CSS para manter largura A4 e gráficos lado a lado
    await page.addStyleTag({
        content: `
            @media print {
                html, body {
                    width: 210mm !important;
                    height: 297mm !important;
                    margin: 0 auto !important;
                    -webkit-print-color-adjust: exact !important;
                }
                .container, .container-fluid {
                    max-width: 100% !important;
                }
                .row {
                    display: flex !important;
                    flex-wrap: wrap !important;
                }
                .col, [class*="col-"] {
                    flex: 1 0 0 !important;
                    max-width: 50% !important;
                }
            }
        `
    });
}

/**
 * Gera PDF A4 otimizado
 */
async function generatePDF(page, options, outputPath) {
    const pdfOptions = {
        path: outputPath,
        format: 'A4',
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
            top: options.marginTop || '8mm',
            right: options.marginRight || '8mm',
            bottom: options.marginBottom || '8mm',
            left: options.marginLeft || '8mm'
        },
        scale: 1
    };
    return page.pdf(pdfOptions);
}

/**
 * Espera gráficos renderizarem (ApexCharts/ECharts)
 */
async function waitForCharts(page) {
    try {
        await page.waitForFunction(
            () => document.querySelectorAll('.apexcharts-canvas, .echarts').length > 0,
            { timeout: 8000 }
        );
        await page.waitForTimeout(500);
    } catch {
        console.log('Gráficos não encontrados ou timeout.');
    }
}

// --- ROTA /CONVERT ---
app.post('/convert', apiKeyAuth, async (req, res) => {
    const { html, options = {} } = req.body;
    if (!html) return res.status(400).json({ success: false, error: 'HTML is required.' });

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.setContent(html, { waitUntil: ['networkidle0', 'domcontentloaded'], timeout: 60000 });

        await configurePageForA4(page);
        await waitForContentLoad(page);
        await waitForCharts(page);

        const pdfBuffer = await generatePDF(page, options);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="output.pdf"',
        });
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Erro ao gerar PDF:', error.message);
        res.status(500).json({ success: false, error: 'Failed to generate PDF.', details: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// --- ROTA /CONVERT-FILE ---
app.post('/convert-file', apiKeyAuth, async (req, res) => {
    const { html, options = {} } = req.body;
    if (!html) return res.status(400).json({ success: false, error: 'HTML is required.' });

    let browser;
    try {
        const filename = `${crypto.randomBytes(20).toString('hex')}.pdf`;
        const outputPath = path.join(OUTPUT_DIR, filename);

        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.setContent(html, { waitUntil: ['networkidle0', 'domcontentloaded'], timeout: 60000 });

        await configurePageForA4(page);
        await waitForContentLoad(page);
        await waitForCharts(page);

        await generatePDF(page, options, outputPath);

        const downloadUrl = `${req.protocol}://${req.get('host')}/download/${filename}`;
        res.status(200).json({ success: true, downloadUrl, expiresIn: '1 hour', filename });

    } catch (error) {
        console.error('Erro ao gerar PDF:', error.message);
        res.status(500).json({ success: false, error: 'Failed to generate PDF.', details: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    const filePath = path.join(OUTPUT_DIR, filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath, () => {
            fs.unlink(filePath, (err) => {
                if (err) console.error(`Erro ao excluir ${filename}:`, err);
            });
        });
    } else {
        res.status(404).json({ error: 'File not found or has expired.' });
    }
});

// --- STATUS ---
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        endpoints: {
            '/convert': 'POST - Convert HTML to PDF (direct response)',
            '/convert-file': 'POST - Convert HTML to PDF (file download)',
            '/download/:filename': 'GET - Download generated PDF',
            '/status': 'GET - API status'
        }
    });
});

// --- INICIALIZAÇÃO ---
app.listen(port, () => {
    console.log(`PDF Generation API is running on port ${port}`);
    console.log(`Status endpoint: http://localhost:${port}/status`);
});
