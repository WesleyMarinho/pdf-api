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

// --- FUNÇÕES AUXILIARES ---

/**
 * Função auxiliar para rolar a página até o final e aguardar carregamento completo.
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
                    setTimeout(resolve, 1000);
                }
            }, 100);
        });
    });
}

/**
 * Aguarda que todos os elementos críticos sejam carregados, com foco especial em gráficos
 * @param {import('puppeteer').Page} page
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
                            const timeout = setTimeout(() => resolve(), 3000);
                            img.onload = img.onerror = () => {
                                clearTimeout(timeout);
                                resolve();
                            };
                        }))
                );
            }),
            new Promise(resolve => setTimeout(resolve, 8000))
        ]);

        console.log('Aguardando carregamento de fontes...');
        await Promise.race([
            page.evaluateHandle(() => document.fonts.ready),
            new Promise(resolve => setTimeout(resolve, 5000))
        ]);

        console.log('Aguardando carregamento do ApexCharts...');
        await page.waitForFunction(
            () => typeof window.ApexCharts !== 'undefined',
            { timeout: 10000 }
        ).catch(() => console.log('ApexCharts não encontrado, continuando...'));

        console.log('Forçando inicialização e re-renderização dos gráficos...');
        // Múltiplas tentativas de inicialização para garantir que os gráficos renderizem
        await page.evaluate(() => {
            // Primeira tentativa - usando o objeto Reports global
            if (window.Reports && typeof window.Reports.init === 'function') {
                console.log('Inicializando via Reports.init()');
                try {
                    window.Reports.init();
                } catch (e) {
                    console.error('Erro na inicialização dos Reports:', e);
                }
            }

            // Segunda tentativa - configuração global para todos os gráficos
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

            // Terceira tentativa - forçar re-render individual de cada gráfico
            if (window.ApexCharts && window.Reports) {
                console.log('Forçando re-render individual dos gráficos');
                setTimeout(() => {
                    try {
                        window.Reports.initializeAllCharts();
                        window.Reports.initializeMiniCharts();
                    } catch (e) {
                        console.error('Erro na re-inicialização:', e);
                    }
                }, 500);
            }
        });

        // Aguarda renderização inicial
        console.log('Aguardando renderização inicial dos gráficos...');
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Verificação e nova tentativa se necessário
        const chartsRendered = await page.evaluate(() => {
            const charts = document.querySelectorAll('.apexcharts-canvas svg');
            if (charts.length === 0) return true;

            let renderedCount = 0;
            charts.forEach(svg => {
                const hasContent = svg.querySelector('g.apexcharts-series path, g.apexcharts-series rect, g.apexcharts-heatmap-series rect');
                if (hasContent) renderedCount++;
            });

            console.log(`Gráficos encontrados: ${charts.length}, Renderizados: ${renderedCount}`);
            return renderedCount > 0 || charts.length === 0;
        });

        if (!chartsRendered) {
            console.log('Tentativa adicional de renderização...');
            await page.evaluate(() => {
                // Última tentativa - força todos os gráficos via jQuery se disponível
                if (window.$ && window.Reports) {
                    try {
                        window.Reports.initializeAllCharts();
                        window.Reports.initializeMiniCharts();
                    } catch (e) {
                        console.error('Erro na última tentativa:', e);
                    }
                }
                
                // Força re-layout manual se necessário
                const charts = document.querySelectorAll('.apexcharts-canvas');
                charts.forEach(chart => {
                    const svg = chart.querySelector('svg');
                    if (svg) {
                        svg.style.maxWidth = '100%';
                        svg.style.width = '100%';
                    }
                });
            });
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log('Verificando lazy loading elements...');
        await Promise.race([
            page.waitForFunction(
                () => {
                    const lazyElements = document.querySelectorAll('[data-src], [loading="lazy"], .lazy');
                    if (lazyElements.length === 0) return true;
                    return Array.from(lazyElements).every(el => {
                        return el.src || el.style.backgroundImage || el.complete;
                    });
                },
                { timeout: 3000 }
            ),
            new Promise(resolve => setTimeout(resolve, 3000))
        ]).catch(() => {
            console.log('Timeout aguardando lazy loading, continuando...');
        });

        console.log('Carregamento de conteúdo concluído.');

    } catch (error) {
        console.log('Erro aguardando carregamento de conteúdo:', error.message);
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
                '--disable-ipc-flooding-protection',
                '--font-render-hinting=medium',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();

        // Capturar erros do console da página
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.error(`[Browser Console ERROR]: ${msg.text()}`);
            } else if (msg.type() === 'log') {
                console.log(`[Browser Console LOG]: ${msg.text()}`);
            }
        });
        
        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['media', 'websocket', 'manifest'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        console.log(`Navegando para: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
        
        console.log('Página carregada, iniciando processamento para PDF...');

        // Força CSS de tela
        await page.emulateMediaType('screen');

        // Aguarda carregamento de conteúdo dinâmico
        await Promise.race([
            waitForContentLoad(page),
            new Promise(resolve => setTimeout(resolve, 20000))
        ]);
        
        // Aguardar gráficos renderizarem com verificação robusta
        try {
            console.log('Verificação final dos gráficos renderizados...');
            await page.waitForFunction(
                () => {
                    const chartElements = document.querySelectorAll('.apexcharts-canvas');
                    if (chartElements.length === 0) return true; 
                    
                    // Verifica se há pelo menos um elemento gráfico renderizado
                    return Array.from(chartElements).some(el => {
                        return el.querySelector('svg g.apexcharts-series path, svg g.apexcharts-series rect, svg g.apexcharts-heatmap-series rect');
                    });
                },
                { timeout: 15000 }
            );
            console.log('Gráficos verificados e renderizados.');
        } catch (e) {
            console.log('Timeout na verificação final dos gráficos, continuando...');
        }
        
        console.log('Aplicando correções finais de CSS...');
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
                
                .apexcharts-legend {
                    max-width: 100% !important;
                    overflow: hidden !important;
                    font-size: 12px !important;
                }
                
                .apexcharts-legend-series {
                    max-width: calc(100% / 4) !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                }
                
                /* Força contenção em todos os containers */
                .grid, .card, .card-content {
                    overflow: hidden !important;
                    box-sizing: border-box !important;
                    max-width: 100% !important;
                }
                
                /* Ajustes específicos para mini gráficos */
                .mini-chart {
                    max-width: 250px !important;
                    overflow: hidden !important;
                    box-sizing: border-box !important;
                }
                
                .mini-chart .apexcharts-canvas,
                .mini-chart svg.apexcharts-svg {
                    max-width: 100% !important;
                    width: 100% !important;
                }
                
                /* Correções para tooltips */
                .apexcharts-tooltip {
                    max-width: 200px !important;
                    word-wrap: break-word !important;
                }
            `
        });

        // Força uma última verificação e ajuste de tamanhos
        await page.evaluate(() => {
            // Ajusta manualmente qualquer elemento que esteja estourando
            const charts = document.querySelectorAll('.apexcharts-canvas');
            charts.forEach(chart => {
                const svg = chart.querySelector('svg');
                if (svg) {
                    svg.style.maxWidth = '100%';
                    svg.style.width = '100%';
                    svg.style.height = 'auto';
                }
            });
            
            // Força re-layout se a função existir
            if (window.Reports && typeof window.Reports.forceChartResize === 'function') {
                try {
                    window.Reports.forceChartResize();
                } catch (e) {
                    console.error('Erro no forceChartResize:', e);
                }
            }
        });

        console.log('Aguardando estabilização final...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('Gerando PDF...');
        
        const isLandscape = typeof landscape === 'boolean' ? landscape : true;
        console.log(`Modo de orientação definido para: ${isLandscape ? 'Paisagem (Landscape)' : 'Retrato (Portrait)'}`);

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
            scale: 0.9, // Escala reduzida para evitar overflow
            timeout: 60000,
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
        version: '1.2.0',
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
        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
        await page.emulateMediaType('screen');
        await page.waitForTimeout(3000);

        const debugInfo = await page.evaluate(() => {
            return {
                puppeteerViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
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
                dpiInfo: {
                    devicePixelRatio: window.devicePixelRatio,
                    dpiCalculated: window.devicePixelRatio * 96,
                    cssPixelRatio: window.devicePixelRatio
                },
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
                browserInfo: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform,
                    language: navigator.language
                },
                chartsInfo: (() => {
                    const charts = document.querySelectorAll('.apexcharts-canvas');
                    return {
                        totalCharts: charts.length,
                        renderedCharts: Array.from(charts).filter(chart => {
                            return chart.querySelector('svg g.apexcharts-series path, svg g.apexcharts-series rect');
                        }).length,
                        apexChartsLoaded: typeof window.ApexCharts !== 'undefined',
                        reportsLoaded: typeof window.Reports !== 'undefined'
                    };
                })(),
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
                    `Gráficos encontrados: ${debugInfo.chartsInfo.totalCharts}, Renderizados: ${debugInfo.chartsInfo.renderedCharts}`
                ],
                pdfSettings: {
                    recommendedViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
                    recommendedFormat: 'A4',
                    recommendedLandscape: true,
                    recommendedScale: 0.9
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
    console.log('Correções para gráficos ApexCharts implementadas');
});
