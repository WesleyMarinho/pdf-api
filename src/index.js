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
        console.warn('WARNING: API_KEY is not defined. Skipping authentication.');
        return next();
    }
    const providedKey = req.header('X-API-KEY');
    if (providedKey && providedKey === API_KEY) {
        return next();
    }
    if (!providedKey) {
        console.warn('Request without API key, but continuing since API_KEY is optional.');
        return next();
    }
    res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
};

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

        console.log('Carregamento de conteúdo concluído.');

    } catch (error) {
        console.log('Erro aguardando carregamento de conteúdo:', error.message);
    }
}

// --- ROTAS DA API ---

// Rota original melhorada para conversão de HTML
app.post('/convert', apiKeyAuth, async (req, res) => {
    const { html, options = {} } = req.body;
    if (!html) {
        return res.status(400).json({ success: false, error: 'HTML is required.' });
    }

    let browser = null;
    try {
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
        
        // Configurações de viewport melhoradas para alta resolução
        await page.setViewport({ 
            width: 1920, 
            height: 1080, 
            deviceScaleFactor: 2 // Melhora a qualidade da renderização
        });

        // Configurações de user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('Definindo conteúdo HTML...');
        
        // Define o conteúdo HTML com timeout estendido
        await page.setContent(html, { 
            waitUntil: ['networkidle0', 'domcontentloaded'], 
            timeout: 60000 
        });
        
        console.log('HTML definido, aguardando conteúdo dinâmico...');
        
        // Aguarda carregamento de conteúdo dinâmico
        await Promise.race([
            waitForContentLoad(page),
            new Promise(resolve => setTimeout(resolve, 10000)) // 10s timeout total
        ]);
        
        // Pausa final para garantir que tudo foi renderizado
        console.log('Aguardando renderização final...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('Gerando PDF...');
        
        // Configurações de PDF melhoradas
        const pdfOptions = {
            format: options.format || 'A4',
            printBackground: true,
            preferCSSPageSize: false,
            margin: {
                top: options.marginTop || '20px',
                right: options.marginRight || '20px',
                bottom: options.marginBottom || '20px',
                left: options.marginLeft || '20px'
            },
            displayHeaderFooter: false,
            scale: options.scale || 0.8, // Reduz um pouco para caber melhor na página
            timeout: 60000
        };
        
        // Gera o PDF com configurações otimizadas
        const pdfBuffer = await page.pdf(pdfOptions);
        
        console.log('PDF gerado com sucesso!');
        
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="output.pdf"',
        });
        res.send(pdfBuffer);

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

// Rota para conversão com download via arquivo (alternativa)
app.post('/convert-file', apiKeyAuth, async (req, res) => {
    const { html, options = {} } = req.body;
    if (!html) {
        return res.status(400).json({ success: false, error: 'HTML is required.' });
    }

    let browser = null;
    try {
        const filename = `${crypto.randomBytes(20).toString('hex')}.pdf`;
        const outputPath = path.join(OUTPUT_DIR, filename);

        // Configurações melhoradas do Puppeteer
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
        
        await page.setViewport({ 
            width: 1920, 
            height: 1080, 
            deviceScaleFactor: 2
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('Definindo conteúdo HTML...');
        
        await page.setContent(html, { 
            waitUntil: ['networkidle0', 'domcontentloaded'], 
            timeout: 60000 
        });
        
        console.log('HTML definido, aguardando conteúdo dinâmico...');
        
        await Promise.race([
            waitForContentLoad(page),
            new Promise(resolve => setTimeout(resolve, 10000))
        ]);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('Gerando PDF...');
        
        const pdfOptions = {
            path: outputPath,
            format: options.format || 'A4',
            printBackground: true,
            preferCSSPageSize: false,
            margin: {
                top: options.marginTop || '20px',
                right: options.marginRight || '20px',
                bottom: options.marginBottom || '20px',
                left: options.marginLeft || '20px'
            },
            displayHeaderFooter: false,
            scale: options.scale || 0.8,
            timeout: 60000
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

// Rota de status para verificar se a API está funcionando
app.get('/status', (req, res) => {
    res.json({ 
        status: 'running', 
        timestamp: new Date().toISOString(),
        version: '1.2.0',
        endpoints: {
            '/convert': 'POST - Convert HTML to PDF (direct response)',
            '/convert-file': 'POST - Convert HTML to PDF (file download)',
            '/download/:filename': 'GET - Download generated PDF',
            '/status': 'GET - API status'
        }
    });
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(port, () => {
    console.log(`PDF Generation API is running on port ${port}`);
    console.log(`Status endpoint: http://localhost:${port}/status`);
    console.log('Available endpoints:');
    console.log('  POST /convert - Convert HTML to PDF (direct response)');
    console.log('  POST /convert-file - Convert HTML to PDF (file download)');
    console.log('  GET /download/:filename - Download generated PDF');
    console.log('  GET /status - API status');
});
