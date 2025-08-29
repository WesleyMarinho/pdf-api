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
const FILE_EXPIRATION_HOURS = process.env.FILE_EXPIRATION_HOURS || 1;
const FILE_EXPIRATION_MS = FILE_EXPIRATION_HOURS * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 900000; // 15 minutos

// --- INICIALIZAÇÃO ---
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
                    console.log(`Imagem ${index + 1} já carregada: ${img.src}`);
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

                    // Força recarregamento se necessário
                    if (img.src) {
                        const currentSrc = img.src;
                        img.src = '';
                        img.src = currentSrc;
                    }
                }
            });

            // Timeout de segurança
            setTimeout(() => {
                console.log('Timeout no carregamento de imagens, continuando...');
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
        // Aguarda carregamento básico da página
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
        ).catch(() => console.log('ApexCharts não encontrado, continuando...'));

        console.log('Forçando inicialização dos gráficos...');
        await page.evaluate(() => {
            if (window.Reports && typeof window.Reports.init === 'function') {
                console.log('Inicializando via Reports.init()');
                try {
                    window.Reports.init();
                } catch (e) {
                    console.error('Erro na inicialização dos Reports:', e);
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
                        console.error('Erro na re-inicialização:', e);
                    }
                }, 1000);
            }
        });

        // Aguarda renderização dos gráficos
        console.log('Aguardando renderização dos gráficos...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Verificação final
        const allLoaded = await page.evaluate(() => {
            // Verifica imagens
            const images = Array.from(document.querySelectorAll('img'));
            const imagesLoaded = images.every(img => img.complete && img.naturalWidth > 0);
            
            // Verifica gráficos
            const charts = document.querySelectorAll('.apexcharts-canvas svg');
            const chartsRendered = charts.length === 0 || Array.from(charts).some(svg => {
                return svg.querySelector('g.apexcharts-series path, g.apexcharts-series rect, g.apexcharts-heatmap-series rect');
            });

            console.log(`Imagens carregadas: ${imagesLoaded}, Gráficos renderizados: ${chartsRendered}`);
            return imagesLoaded && chartsRendered;
        });

        console.log(`Carregamento concluído: ${allLoaded ? 'Sucesso' : 'Parcial'}`);

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
                '--font-render-hinting=medium',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-gpu',
                // Parâmetros específicos para melhor carregamento de imagens
                '--disable-lazy-loading',
                '--disable-background-media-suspend',
                '--autoplay-policy=no-user-gesture-required'
            ]
        });
        
        const page = await browser.newPage();

        // Intercepta apenas recursos desnecessários (mantém imagens)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();
            
            // Bloqueia apenas recursos realmente desnecessários
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
        
        console.log('Página carregada, processando conteúdo...');

        // Força CSS de tela
        await page.emulateMediaType('screen');

        // Aguarda carregamento completo do conteúdo
        await Promise.race([
            waitForContentLoad(page),
            new Promise(resolve => setTimeout(resolve, 25000))
        ]);
        
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

        // Força ajustes finais
        await page.evaluate(() => {
            // Força exibição de imagens lazy
            document.querySelectorAll('img[loading="lazy"]').forEach(img => {
                img.loading = 'eager';
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                }
            });

            // Ajusta gráficos
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

        console.log('Aguardando estabilização final...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('Gerando PDF...');
        
        const isLandscape = typeof landscape === 'boolean' ? landscape : true;
        console.log(`Modo de orientação: ${isLandscape ? 'Paisagem' : 'Retrato'}`);

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
    
    // Validação rigorosa do nome do arquivo
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') || !/^[a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    
    const filePath = path.join(OUTPUT_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }
    
    try {
        // Configurar headers de segurança para download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
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
            console.log(`Download concluído com sucesso: ${filename}`);
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

// Endpoint para visualização inline do PDF (sem forçar download)
app.get('/view/:filename', (req, res) => {
    const { filename } = req.params;
    
    // Validação rigorosa do nome do arquivo
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') || !/^[a-zA-Z0-9_-]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    
    const filePath = path.join(OUTPUT_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found or has expired.' });
    }
    
    try {
        // Configurar headers para visualização inline
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
        
        // Verificar o tamanho do arquivo
        const stats = fs.statSync(filePath);
        res.setHeader('Content-Length', stats.size);
        
        console.log(`Iniciando visualização inline do arquivo: ${filename} (${stats.size} bytes)`);
        
        // Usar stream para envio mais eficiente
        const fileStream = fs.createReadStream(filePath);
        
        fileStream.on('error', (err) => {
            console.error(`Erro ao ler arquivo ${filename}:`, err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file.' });
            }
        });
        
        fileStream.on('end', () => {
            console.log(`Visualização concluída com sucesso: ${filename}`);
        });
        
        // Pipe do arquivo para a resposta
        fileStream.pipe(res);
        
    } catch (error) {
        console.error(`Erro na visualização do arquivo ${filename}:`, error);
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
            'POST /generate-pdf': 'Gera PDF com imagens e gráficos',
            'POST /debug-page': 'Debug de página',
            'GET /download/:filename': 'Download seguro de PDF (forçar download)',
            'GET /view/:filename': 'Visualização inline de PDF (abrir no navegador)',
            'GET /files': 'Lista arquivos disponíveis e horários de expiração',
            'GET /status': 'Status da API'
        },
        security: {
            'download_headers': 'Headers de segurança configurados',
            'filename_validation': 'Validação rigorosa de nomes de arquivo',
            'stream_based': 'Download baseado em streams para eficiência'
        }
    });
});

app.post('/debug-page', apiKeyAuth, async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL é obrigatória' });
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
