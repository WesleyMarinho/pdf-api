// Carrega as variáveis de ambiente do arquivo .env (ótimo para desenvolvimento local)
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const app = express();

// Lê a configuração a partir das variáveis de ambiente com valores padrão
const port = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY; // Não defina um padrão para a chave por segurança
const OUTPUT_DIR = path.join(__dirname, 'generated_pdfs');
const FILE_EXPIRATION_MS = 3600000; // 1 hora em milissegundos

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

// Roda a limpeza a cada 15 minutos para manter o diretório limpo
setInterval(cleanupOldFiles, 900000); // 900000 ms = 15 minutos

// Middlewares
app.use(express.json({ limit: '10mb' })); // Aceita JSON no corpo da requisição

// Middleware de autenticação com API Key
const apiKeyAuth = (req, res, next) => {
    if (!API_KEY) {
        console.error('CRITICAL: API_KEY is not defined in environment variables.');
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    const providedKey = req.header('X-API-KEY');
    if (providedKey && providedKey === API_KEY) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
};

// Endpoint principal para gerar o PDF
app.post('/generate-pdf', apiKeyAuth, async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'The "url" property is required in the JSON body.' });
    }
    
    try {
        new URL(url);
    } catch (_) {
        return res.status(400).json({ error: 'Invalid URL format provided.' });
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
        await page.setViewport({ width: 1280, height: 1024 });
        
        // Navega para a URL e espera que a rede fique ociosa
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
        
        // Simula a mídia de impressão para aplicar estilos de impressão
        await page.emulateMediaType('print');
        
        // Gera o PDF
        await page.pdf({
            path: outputPath,
            format: 'A4',
            printBackground: true,
            fullPage: true, // <-- GARANTE A CAPTURA DA PÁGINA INTEIRA
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

// Endpoint para servir os PDFs gerados para download
app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    
    // Validação de segurança para evitar path traversal
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }

    const filePath = path.join(OUTPUT_DIR, filename);

    if (fs.existsSync(filePath)) {
        // Envia o arquivo para download
        res.download(filePath, (err) => {
            // Após a tentativa de envio (bem-sucedida ou não), apaga o arquivo para evitar re-download
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

app.listen(port, () => {
    console.log(`PDF Generation API is running on port ${port}`);
});
