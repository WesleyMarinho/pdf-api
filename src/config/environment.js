/**
 * Environment Configuration
 * Centralized configuration management for the PDF Generation API
 */

require('dotenv').config();
const { getApiVersionInfo, VERSION_INFO } = require('./version');

const config = {
    // Application Information
    APP_NAME: VERSION_INFO.apiName,
    APP_VERSION: VERSION_INFO.version,
    APP_DESCRIPTION: VERSION_INFO.description,
    BUILD_DATE: VERSION_INFO.buildDate,
    
    // Server Configuration
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Security Configuration
    API_KEY: process.env.API_KEY,
    HTTPS_REDIRECT: process.env.HTTPS_REDIRECT === 'true',
    
    // Performance Configuration
    PUPPETEER_TIMEOUT: parseInt(process.env.PUPPETEER_TIMEOUT) || 120000,
    PDF_GENERATION_TIMEOUT: parseInt(process.env.PDF_GENERATION_TIMEOUT) || 60000,
    
    // File Management Configuration
    OUTPUT_DIR: process.env.OUTPUT_DIR || './generated-pdfs',
    FILE_EXPIRATION_MS: parseInt(process.env.FILE_EXPIRATION_MS) || 604800000, // 7 days
    CLEANUP_INTERVAL_MS: parseInt(process.env.CLEANUP_INTERVAL_MS) || 900000, // 15 minutes
    
    // Development Configuration
    isDevelopment: () => config.NODE_ENV === 'development',
    isProduction: () => config.NODE_ENV === 'production',
    
    // Version Information
    getVersionInfo: () => getApiVersionInfo(),
    
    // Validation
    validate: () => {
        const required = ['API_KEY'];
        const missing = required.filter(key => !config[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
        
        return true;
    }
};

// Validate configuration on load
if (config.NODE_ENV !== 'test') {
    config.validate();
}

module.exports = config;