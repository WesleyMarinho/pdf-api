const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'super_secure_key12345678';
const OUTPUT_DIR = path.join(__dirname, 'generated_pdfs');

// Cria o diretório de saída se ele não existir
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Limpeza automática de arquivos antigos (ex: a cada hora)
setInterval(() => {
    fs.readdir(OUTPUT_DIR, (err, files) => {
        if (err) throw err;
        for (const file of files) {
            const filePath = path.join(OUTPUT_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) throw err;
                // Apaga arquivos com mais de 1 hora
                if (Date.now() - stats.mtime.getTime() > 3600000) {
                    fs.unlink(filePath, (err) => {
                        if (err) console.error(`Failed to delete old file: ${file}`, err);
                        else console.log(`Deleted old file: ${file}`);
                    });
                }
            });
        }
    });
}, 3600000); // Roda a cada 1 hora

// Middlewares
app.use(express.json({ limit: '10mb' })); // Aceita JSON no corpo e aumenta o limite

// Middleware de autenticação com API Key
const apiKeyAuth = (req, res, next) => {
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
    
    // Validação simples da URL
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
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
        await page.emulateMediaType('print');
        await page.pdf({
            path: outputPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        
        // Retorna a URL para download do PDF
        // Usa o cabeçalho 'host' para construir a URL dinamicamente
        const downloadUrl = `${req.protocol}://${req.get('host')}/download/${filename}`;
        res.status(200).json({
            success: true,
            downloadUrl: downloadUrl
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
        res.download(filePath, (err) => {
            if (err) {
                console.error(`Error sending file ${filename}:`, err);
            }
            // Apaga o arquivo após a tentativa de download (bem-sucedida ou não)
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error(`Failed to delete file after download: ${filename}`, unlinkErr);
            });
        });
    } else {
        res.status(404).json({ error: 'File not found or has expired.' });
    }
});

app.listen(port, () => {
    console.log(`PDF Generation API is running on port ${port}`);
});
