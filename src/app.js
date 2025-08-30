/**
 * PDF Generation API Application
 * Main application file with routes and middleware
 * 
 * Versão: Robusta com URL Base Explícita
 * Descrição: Utiliza uma variável de ambiente PUBLIC_BASE_URL para garantir a geração correta
 * das URLs de download e visualização, resolvendo problemas de proxy.
 */

const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Carrega as variáveis de ambiente. Certifique-se de ter um arquivo .env ou configurar no seu host.
require('dotenv').config(); 

const app = express();

// É uma boa prática, mas não dependeremos mais disso para a URL.
app.set('trust proxy', true); 

// --- CONFIGURATION --- 
const OUTPUT_DIR = path.join(__dirname, 'generated_pdfs'); // Ajuste o caminho se necessário

// Carrega as configurações das variáveis de ambiente
const API_KEY = process.env.API_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL; // A URL pública da sua API
const PUPPETEER_TIMEOUT = parseInt(process.env.PUPPETEER_TIMEOUT, 10) || 60000;
const PDF_GENERATION_TIMEOUT = parseInt(process.env.PDF_GENERATION_TIMEOUT, 10) || 90000;
const FILE_EXPIRATION_HOURS = parseInt(process.env.FILE_EXPIRATION_HOURS, 10) || 1;
const FILE_EXPIRATION_MS = FILE_EXPIRATION_HOURS * 3600 * 1000;
const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS, 10) || 900000; // 15 minutos

// Validação CRÍTICA: A aplicação não pode funcionar corretamente sem a URL base pública.
if (!PUBLIC_BASE_URL) {
    console.error('CRITICAL: A variável de ambiente PUBLIC_BASE_URL não está definida. A aplicação não pode iniciar.');
    process.exit(1); // Encerra o processo se a configuração essencial estiver faltando.
}
if (!API_KEY) {
    console.error('CRITICAL: A variável de ambiente API_KEY não está definida. A aplicação não pode iniciar.');
    process.exit(1);
}

// --- LOGGING ---
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
            logOperation('cleanup_error', 'Erro ao ler o diretório de PDFs para limpeza', { error: err.message });
            return;
        }
        files.forEach(file => {
            const filePath = path.join(OUTPUT_DIR, file);
            fs.stat(filePath, (statErr, stats) => {
                if (statErr) return;
                if (Date.now() - stats.mtime.getTime() > FILE_EXPIRATION_MS) {
                    fs.unlink(filePath, (unlinkErr) => {
                        if (unlinkErr) {
                            logOperation('cleanup_error', `Falha ao deletar arquivo expirado: ${file}`, { error: unlinkErr.message });
                        } else {
                            logOperation('cleanup', `Deletado arquivo expirado: ${file}`);
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

// Middleware de Segurança Global
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https') {
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
    if (req.header('X-API-KEY') === API_KEY) {
        return next();
    }
    res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing API Key' });
};

// --- FUNÇÕES AUXILIARES ---
async function waitForContentLoad(page) {
    try {
        await page.waitForLoadState('networkidle0', { timeout: 30000 });
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll("img"));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', resolve); // Resolve on error too
                });
            }));
        });
        await new Promise(resolve => setTimeout(resolve, 3000)); // Tempo extra para renderização de gráficos
    } catch (error) {
        logOperation('content_load_error', 'Timeout ou erro ao esperar pelo conteúdo da página', { error: error.message });
    }
}

// --- ROTAS DA API ---

app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url, options = {}, landscape } = req.body;
    const requestId = crypto.randomBytes(8).toString('hex');

    logOperation('pdf_request', 'Requisição de geração de PDF recebida', { requestId, url });

    if (!url) {
        return res.status(400).json({ success: false, error: 'A propriedade "url" é obrigatória.' });
    }
    try { new URL(url); } catch (_) {
        return res.status(400).json({ success: false, error: 'Formato de URL inválido.' });
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
                '--disable-gpu', '--disable-lazy-loading', '--font-render-hinting=medium',
                '--disable-web-security'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
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
        
        logOperation('pdf_success', `PDF gerado com sucesso: ${filename}`, { requestId });
        
        // CONSTRUÇÃO DAS URLs USANDO A VARIÁVEL DE AMBIENTE
        const downloadUrl = `${PUBLIC_BASE_URL}/download/${filename}`;
        const viewUrl = `${PUBLIC_BASE_URL}/view/${filename}`;

        res.status(200).json({ 
            success: true, 
            downloadUrl: downloadUrl,
            viewUrl: viewUrl,
            expiresIn: `${FILE_EXPIRATION_HOURS} hour(s)`,
            filename: filename
        });

    } catch (error) {
        logOperation('pdf_error', `Falha na geração do PDF: ${error.message}`, { requestId, errorStack: error.stack });
        res.status(500).json({ success: false, error: 'Falha ao gerar o PDF.', details: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    
    // Validação estrita para nomes de arquivo hexadecimais
    if (!filename || !/^[a-f0-9]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Formato de nome de arquivo inválido.' });
    }
    
    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado ou expirado.' });
    }
    
    // Força o download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
});

app.get('/view/:filename', (req, res) => {
    const { filename } = req.params;

    // Validação estrita para nomes de arquivo hexadecimais
    if (!filename || !/^[a-f0-9]+\.pdf$/.test(filename)) {
        return res.status(400).json({ error: 'Formato de nome de arquivo inválido.' });
    }

    const filePath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado ou expirado.' });
    }
    
    // Permite a visualização inline no navegador
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Permite embedding no mesmo domínio
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
                downloadUrl: `${PUBLIC_BASE_URL}/download/${filename}`,
                viewUrl: `${PUBLIC_BASE_URL}/view/${filename}`
            };
        });

        res.json({ success: true, files: fileInfos });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Falha ao listar arquivos.', details: error.message });
    }
});

app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        node_version: process.version
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de Geração de PDF rodando na porta ${PORT}`);
    logOperation('startup', `Aplicação iniciada com URL Base Pública: ${PUBLIC_BASE_URL}`);
});

module.exports = app;
