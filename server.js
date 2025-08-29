#!/usr/bin/env node

/**
 * PDF Generation API Server
 * Entry point for the application
 */

const app = require('./src/app');
const config = require('./src/config/environment');

// Start the server
const server = app.listen(config.PORT, () => {
    console.log(`PDF Generation API is running on port ${config.PORT}`);
    console.log(`Status endpoint: http://localhost:${config.PORT}/status`);
    console.log('Available endpoints:');
    console.log('  POST /convert - Convert HTML to PDF (direct response)');
    console.log('  POST /convert-file - Convert HTML to PDF (file download)');
    console.log('  GET /download/:filename - Download generated PDF');
    console.log('  GET /status - API status');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

module.exports = server;