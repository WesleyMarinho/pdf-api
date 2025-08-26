// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

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
 * Função de limpeza: varre o diretório de PDFs e apaga arquivos mais velhos que FILE_EXPIRATION_MS.
 */
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

// --- ROTAS DA API ---

/**
 * Função auxiliar para rolar a página até o final e aguardar carregamento completo.
 * Isso garante que todos os elementos de lazy-loading sejam acionados.
 * @param {import('puppeteer').Page} page
 */
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    // Aguarda um pouco mais para garantir que imagens e conteúdo dinâmico carreguem
                    setTimeout(resolve, 1000);
                }
            }, 100);
        });
    });
}

/**
 * Aguarda que todos os elementos críticos sejam carregados
 * @param {import('puppeteer').Page} page
 */
async function waitForContentLoad(page) {
    try {
        console.log('Aguardando carregamento de imagens...');
        // Aguarda imagens carregarem com timeout
        await Promise.race([
            page.evaluate(() => {
                return Promise.all(
                    Array.from(document.images)
                        .filter(img => !img.complete)
                        .map(img => new Promise(resolve => {
                            const timeout = setTimeout(() => resolve(), 3000); // 3s timeout por imagem
                            img.onload = img.onerror = () => {
                                clearTimeout(timeout);
                                resolve();
                            };
                        }))
                );
            }),
            new Promise(resolve => setTimeout(resolve, 8000)) // 8s timeout total
        ]);

        console.log('Aguardando carregamento de fontes...');
        // Aguarda fontes carregarem com timeout
        await Promise.race([
            page.evaluateHandle(() => document.fonts.ready),
            new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
        ]);

        console.log('Verificando elementos lazy loading...');
        // Aguarda elementos com lazy loading com timeout reduzido
        await Promise.race([
            page.waitForFunction(
                () => {
                    const lazyElements = document.querySelectorAll('[data-src], [loading="lazy"], .lazy');
                    if (lazyElements.length === 0) return true;
                    return Array.from(lazyElements).every(el => {
                        return el.src || el.style.backgroundImage || el.complete;
                    });
                },
                { timeout: 5000 }
            ),
            new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
        ]).catch(() => {
            console.log('Timeout aguardando lazy loading, continuando...');
        });

        console.log('Carregamento de conteúdo concluído.');

    } catch (error) {
        console.log('Erro aguardando carregamento de conteúdo:', error.message);
    }
}

app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url, options = {} } = req.body;

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

        // Lança o navegador
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
                '--disable-ipc-flooding-protection',
                '--font-render-hinting=none'
            ]
        });

        const page = await browser.newPage();

        // Viewport otimizado para proporção A4
        await page.setViewport({
            width: 1200,       // largura suficiente para 2 colunas lado a lado
            height: 1697,      // altura proporcional a A4
            deviceScaleFactor: 2
        });

        // User-Agent para manter layout desktop
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Intercepta requisições para otimizar o carregamento
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['media', 'websocket', 'manifest'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`Navegando para: ${url}`);

        // Vai para a página
        await page.goto(url, {
            waitUntil: ['networkidle0', 'domcontentloaded'],
            timeout: 120000
        });

        console.log('Página carregada, aguardando conteúdo dinâmico...');

        // Aguarda carregamento básico de imagens e fontes
        await waitForContentLoad(page);

        // Rola a página inteira para carregar tudo (lazy load, etc.)
        await autoScroll(page);

        // Força layout de tela, não impressão
        await page.emulateMediaType('screen');

        // Injeta CSS para garantir largura A4 e manter gráficos lado a lado
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

        // Aguarda os gráficos renderizarem completamente
        try {
            await page.waitForFunction(
                () => document.querySelectorAll('.apexcharts-canvas, .echarts').length > 0,
                { timeout: 10000 }
            );
            await page.waitForTimeout(500);
        } catch {
            console.log('Gráficos não encontrados ou timeout — continuando...');
        }

        // Pausa final para garantir renderização
        console.log('Aguardando renderização final...');
        await page.waitForTimeout(2000);

        console.log('Gerando PDF...');

        // Configurações do PDF otimizadas para A4 perfeito
        const pdfOptions = {
            path: outputPath,
            format: 'A4',               // tamanho fixo
            landscape: false,           // modo retrato
            printBackground: true,      // preserva cores e gráficos
            preferCSSPageSize: true,    // respeita o tamanho definido no CSS
            margin: {
                top: options.marginTop || '8mm',
                right: options.marginRight || '8mm',
                bottom: options.marginBottom || '8mm',
                left: options.marginLeft || '8mm'
            },
            scale: 1
        };

        // Gera o PDF final
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
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    const filePath = path.join(OUTPUT_DIR, filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            // Remove o arquivo após o download
            if (fs.existsSync(filePath)) {
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error(`Failed to delete file after download: ${filename}`, unlinkErr);
                });
            }
            if (err) {
                console.error(`Error sending file ${filename} to client:`, err);
            }
        });
    } else {
        res.status(404).json({ error: 'File not found or has expired.' });
    }
});

// Rota de status para verificar se a API está funcionando
app.get('/status', (req, res) => {
    res.json({ 
        status: 'running', 
        timestamp: new Date().toISOString(),
        version: '1.1.0'
    });
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(port, () => {
    console.log(`PDF Generation API is running on port ${port}`);
    console.log(`Status endpoint: http://localhost:${port}/status`);
});
