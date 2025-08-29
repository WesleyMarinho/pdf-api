/**
 * Version Configuration
 * Centralized version management for the PDF Generation API
 */

const packageJson = require('../../package.json');

/**
 * Application version information
 */
const VERSION_INFO = {
  // Current version from package.json
  version: packageJson.version,
  
  // Version components
  major: parseInt(packageJson.version.split('.')[0]),
  minor: parseInt(packageJson.version.split('.')[1]),
  patch: parseInt(packageJson.version.split('.')[2]),
  
  // Build information
  buildDate: new Date().toISOString(),
  nodeVersion: process.version,
  
  // API information
  apiName: packageJson.name,
  description: packageJson.description,
  author: packageJson.author,
  license: packageJson.license,
  
  // Feature flags based on version
  features: {
    pdfGeneration: true,
    secureDownloads: true,
    inlineViewing: true,
    imageOptimization: true,
    chartRendering: true,
    fileExpiration: true,
    apiKeyAuth: true
  }
};

/**
 * Get formatted version string
 * @returns {string} Formatted version (e.g., "v1.0.0")
 */
function getVersionString() {
  return `v${VERSION_INFO.version}`;
}

/**
 * Get full version information
 * @returns {object} Complete version information
 */
function getFullVersionInfo() {
  return {
    ...VERSION_INFO,
    versionString: getVersionString(),
    isProduction: process.env.NODE_ENV === 'production',
    timestamp: Date.now()
  };
}

/**
 * Check if current version is compatible with minimum required version
 * @param {string} minVersion - Minimum required version (e.g., "1.0.0")
 * @returns {boolean} True if compatible
 */
function isVersionCompatible(minVersion) {
  const [minMajor, minMinor, minPatch] = minVersion.split('.').map(Number);
  const { major, minor, patch } = VERSION_INFO;
  
  if (major > minMajor) return true;
  if (major < minMajor) return false;
  if (minor > minMinor) return true;
  if (minor < minMinor) return false;
  return patch >= minPatch;
}

/**
 * Get version for API responses
 * @returns {object} Version info for API responses
 */
function getApiVersionInfo() {
  return {
    version: VERSION_INFO.version,
    apiName: VERSION_INFO.apiName,
    buildDate: VERSION_INFO.buildDate,
    features: Object.keys(VERSION_INFO.features).filter(
      key => VERSION_INFO.features[key]
    )
  };
}

module.exports = {
  VERSION_INFO,
  getVersionString,
  getFullVersionInfo,
  isVersionCompatible,
  getApiVersionInfo
};