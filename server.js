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

        // Configurações melhoradas do Puppeteer
        browser = await puppeteer.launch({
            headless: "new", // Usa o novo modo headless
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
        
        // Configurar viewport de desktop largo para evitar layout mobile
        await page.setViewport({
            width: 1600,
            height: 1000,
            deviceScaleFactor: 2
        });

        // Configurações de user agent e headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Intercepta requests para otimizar carregamento
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            // Bloqueia recursos desnecessários para PDF
            if (['media', 'websocket', 'manifest'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`Navegando para: ${url}`);
        
        // Navega para a página com timeout estendido
        await page.goto(url, { 
            waitUntil: ['networkidle0', 'domcontentloaded'], 
            timeout: 120000 
        });
        
        console.log('Página carregada, aguardando conteúdo dinâmico...');
        
        // Aguarda carregamento de conteúdo dinâmico com timeout total
        console.log('Iniciando carregamento de conteúdo dinâmico...');
        await Promise.race([
            waitForContentLoad(page),
            new Promise(resolve => setTimeout(resolve, 15000)) // 15s timeout total
        ]);
        
        // Rola a página para carregar todo o conteúdo
        console.log('Rolando página para carregar conteúdo...');
        await Promise.race([
            autoScroll(page),
            new Promise(resolve => setTimeout(resolve, 10000)) // 10s timeout para scroll
        ]);
        
        // Forçar CSS de tela (não de impressão) para manter layout desktop
        await page.emulateMediaType('screen');
        
        // Adicionar CSS para evitar quebras de layout em modo print
        await page.addStyleTag({ content: `
            @media print {
                .no-print-break { break-inside: avoid !important; }
                .container, .container-fluid { max-width: 100% !important; }
                .row { display: flex !important; flex-wrap: wrap !important; }
                .col, .col-* { flex: 1 !important; min-width: 0 !important; }
            }
        `});
        
        // Debug: Capturar informações de resolução e DPI
        const pageInfo = await page.evaluate(() => {
            return {
                // Informações da tela/viewport
                screenWidth: window.screen.width,
                screenHeight: window.screen.height,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                documentWidth: document.documentElement.scrollWidth,
                documentHeight: document.documentElement.scrollHeight,
                
                // DPI e densidade de pixels
                devicePixelRatio: window.devicePixelRatio,
                dpi: window.devicePixelRatio * 96, // DPI padrão do CSS é 96
                
                // Informações de CSS
                cssPixelRatio: window.devicePixelRatio,
                
                // Media queries ativas
                mediaQueries: {
                    print: window.matchMedia('print').matches,
                    screen: window.matchMedia('screen').matches,
                    minWidth1200: window.matchMedia('(min-width: 1200px)').matches,
                    minWidth1400: window.matchMedia('(min-width: 1400px)').matches,
                    minWidth1600: window.matchMedia('(min-width: 1600px)').matches
                },
                
                // User agent
                userAgent: navigator.userAgent
            };
        });
        
        console.log('📊 Informações de Resolução e DPI:');
        console.log('   Viewport Puppeteer: 1600x1000 (configurado)');
        console.log(`   Viewport da Página: ${pageInfo.viewportWidth}x${pageInfo.viewportHeight}`);
        console.log(`   Documento Total: ${pageInfo.documentWidth}x${pageInfo.documentHeight}`);
        console.log(`   Tela: ${pageInfo.screenWidth}x${pageInfo.screenHeight}`);
        console.log(`   Device Pixel Ratio: ${pageInfo.devicePixelRatio}`);
        console.log(`   DPI Calculado: ${pageInfo.dpi}`);
        console.log(`   Media Queries Ativas:`, pageInfo.mediaQueries);
        
        // Aguardar gráficos renderizarem (ApexCharts/ECharts)
        try {
            await page.waitForFunction(
                () => document.querySelectorAll('.apexcharts-canvas, .echarts').length > 0,
                { timeout: 10000 }
            );
            await new Promise(resolve => setTimeout(resolve, 500)); // Buffer para renderização completa
        } catch (e) {
            console.log('Gráficos não encontrados ou timeout - continuando...');
        }
        
        // Pausa final para garantir que tudo foi renderizado
        console.log('Aguardando renderização final...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('Gerando PDF...');
        
        // Configurações de PDF melhoradas
        const pdfOptions = {
            path: outputPath,
            format: options.format || 'A4',
            landscape: false,  // Modo paisagem para manter layout de duas colunas
            printBackground: true,
            preferCSSPageSize: false,
            margin: {
                top: options.marginTop || '10mm',
                right: options.marginRight || '10mm',
                bottom: options.marginBottom || '10mm',
                left: options.marginLeft || '10mm'
            },
            displayHeaderFooter: false,
            scale: 1,  // Scale 1 para manter qualidade
            timeout: 60000
        };
        
        // Gera o PDF com configurações otimizadas
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

// Endpoint de status da API
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        version: '1.1.0',
        endpoints: {
            'POST /generate-pdf': 'Gera PDF a partir de URL',
            'POST /debug-page': 'Debug de resolução e DPI da página',
            'GET /download/:filename': 'Download de PDF gerado',
            'GET /status': 'Status da API'
        }
    });
});

// Endpoint de debug para capturar informações de resolução
app.post('/debug-page', apiKeyAuth, async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL é obrigatória' });
    }
    
    let browser;
    try {
        console.log(`🔍 Debug da página: ${url}`);
        
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        // Configurar viewport de desktop largo
        await page.setViewport({
            width: 1600,
            height: 1000,
            deviceScaleFactor: 2
        });
        
        // Navegar para a página
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
        
        // Forçar CSS de tela
        await page.emulateMediaType('screen');
        
        // Aguardar carregamento
        await page.waitForTimeout(3000);
        
        // Capturar informações detalhadas
        const debugInfo = await page.evaluate(() => {
            return {
                // Configurações do Puppeteer
                puppeteerViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
                
                // Informações da página
                pageInfo: {
                    screenWidth: window.screen.width,
                    screenHeight: window.screen.height,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    documentWidth: document.documentElement.scrollWidth,
                    documentHeight: document.documentElement.scrollHeight,
                    bodyWidth: document.body.scrollWidth,
                    bodyHeight: document.body.scrollHeight
                },
                
                // DPI e densidade
                dpiInfo: {
                    devicePixelRatio: window.devicePixelRatio,
                    dpiCalculated: window.devicePixelRatio * 96,
                    cssPixelRatio: window.devicePixelRatio
                },
                
                // Media queries
                mediaQueries: {
                    print: window.matchMedia('print').matches,
                    screen: window.matchMedia('screen').matches,
                    minWidth576: window.matchMedia('(min-width: 576px)').matches,
                    minWidth768: window.matchMedia('(min-width: 768px)').matches,
                    minWidth992: window.matchMedia('(min-width: 992px)').matches,
                    minWidth1200: window.matchMedia('(min-width: 1200px)').matches,
                    minWidth1400: window.matchMedia('(min-width: 1400px)').matches,
                    minWidth1600: window.matchMedia('(min-width: 1600px)').matches,
                    maxWidth767: window.matchMedia('(max-width: 767px)').matches,
                    maxWidth991: window.matchMedia('(max-width: 991px)').matches
                },
                
                // Informações do navegador
                browserInfo: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform,
                    language: navigator.language
                },
                
                // CSS computado de elementos importantes
                elementsInfo: (() => {
                    const container = document.querySelector('.container, .container-fluid');
                    const row = document.querySelector('.row');
                    const cols = document.querySelectorAll('[class*="col-"]');
                    
                    return {
                        containerWidth: container ? getComputedStyle(container).width : 'não encontrado',
                        containerMaxWidth: container ? getComputedStyle(container).maxWidth : 'não encontrado',
                        rowDisplay: row ? getComputedStyle(row).display : 'não encontrado',
                        colsCount: cols.length,
                        firstColWidth: cols[0] ? getComputedStyle(cols[0]).width : 'não encontrado'
                    };
                })()
            };
        });
        
        await browser.close();
        
        res.json({
            success: true,
            url: url,
            timestamp: new Date().toISOString(),
            debugInfo: debugInfo,
            recommendations: {
                cssAdjustments: [
                    'Para ajustar o CSS, use as informações de viewport e media queries',
                    `Viewport atual: ${debugInfo.pageInfo.viewportWidth}x${debugInfo.pageInfo.viewportHeight}`,
                    `DPI: ${debugInfo.dpiInfo.dpiCalculated}`,
                    'Media queries ativas mostram quais breakpoints estão funcionando'
                ],
                pdfSettings: {
                    recommendedViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
                    recommendedFormat: 'A4',
                    recommendedLandscape: true,
                    recommendedScale: 1
                }
            }
        });
        
    } catch (error) {
        if (browser) await browser.close();
        console.error('Erro no debug:', error);
        res.status(500).json({ error: 'Erro ao fazer debug da página', details: error.message });
    }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(port, () => {
    console.log(`PDF Generation API is running on port ${port}`);
    console.log(`Status endpoint: http://localhost:${port}/status`);
});
