# Changelog

All notable changes to the PDF Generation API project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Version management system
- Centralized version configuration
- Version information in API responses
- NPM scripts for version management

## [1.0.0] - 2024-01-29

### Added
- Complete internationalization to English
- Professional folder structure implementation
- Centralized environment configuration
- Comprehensive API documentation
- Security improvements with API key authentication
- File expiration and cleanup system
- PDF generation with Puppeteer
- Secure file download and inline viewing
- Image optimization and chart rendering support
- Postman collection for API testing
- Docker support
- Professional README documentation

### Changed
- Project structure reorganized for scalability
- All Portuguese content translated to English
- Server entry point moved to `server.js`
- Configuration centralized in `src/config/`
- Assets organized in `public/assets/`
- Documentation moved to `docs/` folder

### Fixed
- FILE_EXPIRATION_HOURS configuration error
- API endpoint consistency
- Environment variable validation
- File path references in package.json

### Security
- API key authentication implementation
- Secure file handling
- Input validation improvements

---

## Version Management Guide

### Semantic Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** version when you make incompatible API changes
- **MINOR** version when you add functionality in a backwards compatible manner
- **PATCH** version when you make backwards compatible bug fixes

### Version Update Commands

```bash
# Check current version
npm run version:check

# Increment patch version (1.0.0 -> 1.0.1)
npm run version:patch

# Increment minor version (1.0.0 -> 1.1.0)
npm run version:minor

# Increment major version (1.0.0 -> 2.0.0)
npm run version:major
```

### Release Process

1. Update CHANGELOG.md with new version changes
2. Run appropriate version command
3. Commit changes with version tag
4. Push to repository with tags
5. Create GitHub release if applicable

### Changelog Categories

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes