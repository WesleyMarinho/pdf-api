// Carrega as variáveis de ambiente do arquivo .env (ótimo para desenvolvimento local)
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const app = express();

// --- CONFIGURAÇÃO ---
// Lê a configuração a partir das variáveis de ambiente com valores padrão
const port = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY; // Não defina um padrão para a chave por segurança
const OUTPUT_DIR = path.join(__dirname, 'generated_pdfs');
const FILE_EXPIRATION_MS = 3600000; // 1 hora em milissegundos
const CLEANUP_INTERVAL_MS = 900000; // 15 minutos em milissegundos

// --- INICIALIZAÇÃO ---
// Cria o diretório de saída se ele não existir
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
                
                // Apaga arquivos com mais de 1 hora
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

// Roda a limpeza em intervalos definidos
setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS);

// --- MIDDLEWARES ---
// Aceita JSON no corpo da requisição com um limite maior
app.use(express.json({ limit: '10mb' }));

/**
 * Middleware de autenticação com API Key.
 * Verifica a presença e validade do cabeçalho X-API-KEY.
 */
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
 * Rota principal para gerar o PDF.
 * Método: POST
 * Endpoint: /generate-pdf
 * Body: { "url": "https://..." }
 */
app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url } = req.body;

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
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        
        // Define um viewport de desktop para garantir a renderização correta de layouts responsivos
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Navega para a URL e espera o conteúdo principal ser carregado
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

        // Injeta CSS para desativar animações e transições, garantindo a captura do estado final
        await page.addStyleTag({
            content: `
              *, *::before, *::after {
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
        
        // Adiciona uma pausa extra para permitir que scripts de lazy-loading de imagens e fontes terminem
        await new Promise(resolve => setTimeout(resolve, 3000)); // Espera 3 segundos

        // Simula a mídia de impressão
        await page.emulateMediaType('print');
        
        // Gera o PDF da página inteira
        await page.pdf({
            path: outputPath,
            format: 'A4',
            printBackground: true,
            fullPage: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        
        // Constrói a URL de download dinamicamente
        const downloadUrl = `${req.protocol}://${req.get('host')}/download/${filename}`;
        
        res.status(200).json({
            success: true,
            downloadUrl: downloadUrl,
            expiresIn: '1 hour'
        });

    } catch (error) {
        console.error('PDF Generation Error:', error.message);
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

/**
 * Rota para servir os PDFs gerados para download.
 * Método: GET
 * Endpoint: /download/:filename
 */
app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    
    // Validação de segurança para evitar path traversal
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }

    const filePath = path.join(OUTPUT_DIR, filename);

    if (fs.existsSync(filePath)) {
        // Envia o arquivo para download e apaga-o após o envio
        res.download(filePath, (err) => {
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


// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(port, () => {
    console.log(`PDF Generation API is running on port ${port}`);
});
