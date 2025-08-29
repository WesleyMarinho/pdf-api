#!/usr/bin/env node
/**
 * Version Manager Script
 * Utility script for managing project versions
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get package.json path
const packagePath = path.join(__dirname, '..', 'package.json');
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

/**
 * Read package.json
 */
function getPackageInfo() {
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    return JSON.parse(packageContent);
}

/**
 * Update CHANGELOG.md with new version
 */
function updateChangelog(version, type) {
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    const today = new Date().toISOString().split('T')[0];
    
    // Replace [Unreleased] with new version
    const updatedChangelog = changelogContent.replace(
        '## [Unreleased]',
        `## [Unreleased]\n\n### Added\n- \n\n### Changed\n- \n\n### Fixed\n- \n\n## [${version}] - ${today}`
    );
    
    fs.writeFileSync(changelogPath, updatedChangelog);
    console.log(`✅ Updated CHANGELOG.md for version ${version}`);
}

/**
 * Display current version info
 */
function showVersionInfo() {
    const pkg = getPackageInfo();
    const { getFullVersionInfo } = require('../src/config/version');
    const versionInfo = getFullVersionInfo();
    
    console.log('\n📦 Current Version Information:');
    console.log('================================');
    console.log(`Name: ${pkg.name}`);
    console.log(`Version: ${pkg.version}`);
    console.log(`Description: ${pkg.description}`);
    console.log(`Build Date: ${versionInfo.buildDate}`);
    console.log(`Node Version: ${versionInfo.nodeVersion}`);
    console.log(`Environment: ${versionInfo.isProduction ? 'Production' : 'Development'}`);
    console.log('\n🚀 Available Features:');
    Object.entries(versionInfo.features).forEach(([feature, enabled]) => {
        console.log(`  ${enabled ? '✅' : '❌'} ${feature}`);
    });
    console.log('\n📋 Version Management Commands:');
    console.log('  npm run version:check    - Show current version');
    console.log('  npm run version:patch    - Increment patch version');
    console.log('  npm run version:minor    - Increment minor version');
    console.log('  npm run version:major    - Increment major version');
    console.log('  node scripts/version-manager.js info - Show detailed version info');
}

/**
 * Main function
 */
function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
        case 'info':
        case 'show':
        case 'status':
            showVersionInfo();
            break;
            
        case 'update-changelog':
            const version = args[1];
            const type = args[2] || 'patch';
            if (!version) {
                console.error('❌ Version is required for changelog update');
                process.exit(1);
            }
            updateChangelog(version, type);
            break;
            
        default:
            console.log('\n🔧 Version Manager - PDF Generation API');
            console.log('========================================');
            console.log('\nUsage:');
            console.log('  node scripts/version-manager.js info              - Show version information');
            console.log('  node scripts/version-manager.js update-changelog  - Update changelog');
            console.log('\nFor version updates, use npm scripts:');
            console.log('  npm run version:patch');
            console.log('  npm run version:minor');
            console.log('  npm run version:major');
            break;
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = {
    getPackageInfo,
    updateChangelog,
    showVersionInfo
};