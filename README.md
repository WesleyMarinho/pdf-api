# PDF Generation API

![PDF API](./public/assets/icon.svg)

A robust and secure API for generating high-quality PDFs from URLs using Puppeteer with advanced image loading, chart rendering, automatic file replacement, and comprehensive security features.

## 🔗 Important Access Links

- **API Base URL**: `http://localhost:3000` (Development)
- **API Status**: `GET /status`
- **Postman Collection**: [Download JSON](./docs/postman-collection.json)
- **GitHub Repository**: [PDF API Repository](https://github.com/WesleyMarinho/pdf-api)
- **Live Demo**: Coming Soon

## 🚀 Features

- **High-Quality PDF Generation**: Convert web pages to PDFs with excellent resolution
- **Advanced Image Loading**: Optimized loading for all image types including lazy-loaded content
- **Chart Rendering Support**: Full support for ApexCharts, ECharts, and other dynamic charts
- **Automatic File Replacement**: Intelligent file management that replaces existing files with the same name
- **Security Headers**: Comprehensive security headers to prevent browser warnings
- **File Management**: Automatic cleanup of old files with configurable expiration (1 hour default)
- **Multiple Download Options**: Force download or inline viewing
- **Stream-Based Downloads**: Efficient file serving with proper error handling
- **API Key Authentication**: Secure access control
- **Filename Sanitization**: Automatic filename validation and sanitization

## 📋 System Requirements

### Minimum Requirements
- **Node.js**: 16.0.0 or higher (recommended: 18.x LTS)
- **npm**: 8.0.0 or higher
- **Memory**: 2GB RAM minimum (4GB recommended for complex pages)
- **Storage**: 1GB free space for temporary PDF files
- **Operating System**: Windows 10+, macOS 10.14+, or Linux (Ubuntu 18.04+)

### Dependencies
- **Chrome/Chromium**: Automatically installed with Puppeteer
- **Express.js**: Web framework for API endpoints
- **Puppeteer**: Headless Chrome automation
- **dotenv**: Environment variable management

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/WesleyMarinho/pdf-api.git
   cd pdf-api
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env
   ```

4. **Configure environment variables**
   ```env
   PORT=3000
   API_KEY=your-secure-api-key-here
   ```

5. **Start the server**
   ```bash
   # Production mode
   npm start
   
   # Development mode with auto-restart
   npm run dev
   
   # Direct execution
   node server.js
   ```

## 📦 Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `npm start` | Start the server in production mode |
| `dev` | `npm run dev` | Start the server in development mode with auto-restart (nodemon) |
| `version:check` | `npm run version:check` | Display current version |
| `version:patch` | `npm run version:patch` | Increment patch version (1.0.0 → 1.0.1) |
| `version:minor` | `npm run version:minor` | Increment minor version (1.0.0 → 1.1.0) |
| `version:major` | `npm run version:major` | Increment major version (1.0.0 → 2.0.0) |

### Development Workflow

```bash
# Install dependencies
npm install

# Start development server with auto-restart
npm run dev

# Check current version
npm run version:check

# Update version before deployment
npm run version:patch  # for bug fixes
npm run version:minor  # for new features
npm run version:major  # for breaking changes
```

## 🔧 Configuration

### Environment Variables

#### Basic Configuration

| Variable | Description | Default |
|----------|-------------|----------|
| `PORT` | Server port | `3000` |
| `API_KEY` | API authentication key | Required |
| `NODE_ENV` | Environment mode | `development` |
| `HTTPS_REDIRECT` | Redirect HTTP to HTTPS | `false` |

#### Advanced Performance Configuration

| Variable | Description | Default | Notes |
|----------|-------------|---------|-------|
| `PUPPETEER_TIMEOUT` | Puppeteer browser timeout (ms) | `120000` | 2 minutes |
| `PDF_GENERATION_TIMEOUT` | PDF generation timeout (ms) | `60000` | 1 minute |
| `FILE_EXPIRATION_MS` | File expiration time (ms) | `3600000` | 1 hour |
| `CLEANUP_INTERVAL_MS` | Cleanup interval (ms) | `900000` | 15 minutes |

#### Complete .env Example

```env
# Advanced PDF Generation API Configuration

## Server Configuration
PORT=3000                  # Server execution port (default: 3000)
NODE_ENV=development       # Runtime environment (development/production)

## Security Configuration
HTTPS_REDIRECT=false       # Redirect HTTP to HTTPS (true/false)
API_KEY=your_secret_api_key_here  # Secret key for API authentication

## Performance Configuration
PUPPETEER_TIMEOUT=120000   # Puppeteer timeout in milliseconds (2 minutes)
PDF_GENERATION_TIMEOUT=60000 # PDF generation timeout in milliseconds (1 minute)

## File Management
FILE_EXPIRATION_MS=3600000 # File expiration time in milliseconds (1 hour)
CLEANUP_INTERVAL_MS=900000  # Cleanup interval in milliseconds (15 minutes)
```

### API Key Configuration

**IMPORTANT**: The API key is required for the following endpoints:
- `POST /generate-pdf` - Generate PDF from URL
- `GET /files` - List available files
- `POST /debug-page` - Debug page information

**Public endpoints** (no API key required):
- `GET /status` - API status
- `GET /download/:filename` - Download PDF files
- `GET /view/:filename` - View PDF files inline

#### Setting up your API Key:

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Generate a secure API key:**
   ```bash
   # Example of a secure API key
   API_KEY=pdf_api_2024_secure_key_abc123xyz789
   ```

3. **Update your .env file:**
   ```env
   API_KEY=your-actual-secure-api-key-here
   ```

4. **Restart the server** after updating the .env file.

#### Troubleshooting API Key Issues:

- **Error 500 "Server configuration error"**: The API_KEY environment variable is not set
- **Error 401 "Unauthorized"**: Invalid or missing API key in request headers
- **Solution**: Ensure your .env file exists and contains a valid API_KEY value

### File Management

- **Output Directory**: `./generated-pdfs/`
- **File Expiration**: Configurable via `FILE_EXPIRATION_MS` (default: 1 hour)
- **Cleanup Interval**: Configurable via `CLEANUP_INTERVAL_MS` (default: 15 minutes)
- **Supported Formats**: PDF only
- **Automatic Cleanup**: Old files are automatically removed based on expiration settings
- **File Replacement**: Existing files with the same name are automatically replaced

#### Automatic File Replacement

The API now includes intelligent file replacement functionality:

- **Same Name Detection**: When generating a PDF with a filename that already exists, the system automatically detects the conflict
- **Old File Removal**: The existing file is completely removed before creating the new one
- **Seamless Replacement**: Only the latest version of the file remains, ensuring no duplicates
- **Logging**: All file replacement operations are logged for monitoring
- **Expiration Maintained**: The new file maintains the standard 1-hour expiration time

**Example Behavior:**
1. Generate PDF with filename `report.pdf` → File created
2. Generate another PDF with filename `report.pdf` → Old file removed, new file created
3. Only the latest `report.pdf` exists in the system

**Benefits:**
- Prevents storage bloat from duplicate files
- Ensures users always get the most recent version
- Maintains consistent file management
- Automatic cleanup without manual intervention

### 📊 Logging and Monitoring

The API includes comprehensive logging for all operations:

#### Log Types

- **PDF Generation Logs**: Track successful generations, failures, and timeouts
- **Download Logs**: Monitor file access and download operations
- **Error Logs**: Detailed error tracking with stack traces
- **Performance Logs**: Response times and resource usage
- **Security Logs**: API key validation and access attempts

#### Log Format

```json
{
  "timestamp": "2024-01-20T10:30:45.123Z",
  "level": "info",
  "operation": "pdf_generation",
  "requestId": "req_abc123",
  "details": {
    "url": "https://example.com",
    "filename": "document_20240120.pdf",
    "duration": 3500,
    "status": "success"
  }
}
```

#### Monitoring Endpoints

- **Health Check**: `GET /status` - Server status and configuration
- **File Listing**: `GET /files` - Active files and expiration status

#### Timeout Handling

- **Puppeteer Timeout**: Configurable browser navigation timeout
- **PDF Generation Timeout**: Separate timeout for PDF creation process
- **Graceful Degradation**: Proper error responses for timeout scenarios
- **Resource Cleanup**: Automatic browser cleanup on timeouts

## 📋 Postman Collection

### Prerequisites and Dependencies

Before using the Postman collection, ensure you have:

1. **Postman Desktop App** (recommended) or **Postman Web**
   - Download from: https://www.postman.com/downloads/
   - Version 10.0+ recommended for full feature support

2. **API Server Running**
   - Start the server: `npm start` or `node server.js`
   - Default URL: `http://localhost:3000`
   - Verify status: `GET http://localhost:3000/status`

3. **Environment Setup**
   - The collection includes pre-configured variables
   - Base URL is set to `http://localhost:3000` by default
   - Valid API key configured in environment variables (see [API Key Configuration](#api-key-configuration))
   - `.env` file with API_KEY variable set
   - Can be modified for production environments

### 📥 How to Import and Use the Postman Collection

#### Step 1: Download the Collection
1. Download the `postman-collection.json` file from this repository
2. Save it to your local machine

#### Step 2: Import into Postman
1. Open Postman Desktop App
2. Click **"Import"** button (top-left corner)
3. Select **"Upload Files"** tab
4. Choose the downloaded `postman-collection.json` file
5. Click **"Import"** to add the collection

#### Step 3: Configure Environment (Optional)
1. The collection includes default variables:
   - `base_url`: `http://localhost:3000`
   - `api_version`: `1.5.0`
2. To modify for production:
   - Go to **Environments** tab
   - Create new environment or edit existing
   - Set `base_url` to your production URL
   - **Set `api_key` to your actual API key from .env file**

#### Step 4: Configure API Key in Postman
1. After importing, go to the collection variables
2. Update the `api_key` variable with your actual API key
3. Or set it as an environment variable in Postman
4. The key will be automatically included in protected endpoints

#### Step 4: Test the Collection
1. Ensure your API server is running
2. Start with the **"API Status"** request to verify connectivity
3. Use **"Generate PDF from URL"** to create your first PDF
4. Test file management endpoints as needed

### 🔧 Collection Structure

The Postman collection is organized into **3 main folders**:

#### 1. **PDF Generation**
- `POST /generate-pdf` - Generate PDF from URL with full customization options

#### 2. **File Management**
- `GET /download/:filename` - Download PDF files (force download)
- `GET /view/:filename` - View PDF files inline in browser
- `GET /files` - List all available files with expiration info

#### 3. **API Status & Debug**
- `GET /status` - Check API health and system information
- `POST /debug-page` - Debug page loading and rendering issues

### 🧪 Built-in Tests and Validation

Each request includes automatic tests for:
- **Status Code Validation**: Ensures successful responses (200, 201, 202)
- **Response Time Check**: Validates reasonable response times (<30s)
- **Security Headers**: Verifies presence of security headers
- **Content Type Validation**: Ensures proper content types

### 📝 Example Usage Scenarios

#### Scenario 1: Basic PDF Generation
1. Use **"Generate PDF from URL"** request
2. Modify the URL in the request body
3. Customize filename and format options
4. Send request and note the response URLs
5. Use **"Download PDF"** or **"View PDF Inline"** with the filename

#### Scenario 2: Debugging Issues
1. If PDF generation fails, use **"Debug Page"** request
2. Include the problematic URL
3. Enable debug options (screenshot, console, network)
4. Analyze the detailed response for troubleshooting

#### Scenario 3: File Management
1. Use **"List Available Files"** to see all generated PDFs
2. Check expiration times and file sizes
3. Download or view files as needed

### 🔒 Security Considerations

- All requests include proper security headers
- HTTPS enforcement is configured (redirects HTTP to HTTPS in production)
- Filename validation prevents directory traversal attacks
- Stream-based downloads for efficiency and security
- HSTS (HTTP Strict Transport Security) headers included

## 📚 API Documentation

### Base URL
```
http://localhost:3000
```

### Authentication
All endpoints require an API key in the header:
```
X-API-Key: your-api-key
```

### Endpoints

#### 1. Generate PDF
**POST** `/generate-pdf`

Generate a PDF from a URL with optimized image and chart rendering.

**Request Body:**
```json
{
  "url": "https://example.com",
  "landscape": true,
  "filename": "custom-name"
}
```

**Parameters:**
- `url` (required): The URL to convert to PDF
- `landscape` (optional): Orientation - `true` for landscape, `false` for portrait (default: `true`)
- `filename` (optional): Custom filename without extension (auto-generated if not provided)

**Response:**
```json
{
  "success": true,
  "filename": "generated-file-name.pdf",
  "downloadUrl": "/download/generated-file-name.pdf",
  "viewUrl": "/view/generated-file-name.pdf",
  "expiresAt": "2024-01-20T15:30:00.000Z",
  "fileSize": 1024576
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/generate-pdf \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://example.com",
    "landscape": true,
    "filename": "my-report"
  }'
```

#### 2. Download PDF (Force Download)
**GET** `/download/:filename`

Download a generated PDF file with force download headers.

**Parameters:**
- `filename`: The PDF filename (must match exactly)

**Response:** PDF file download

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/download/my-report.pdf \
  -o downloaded-file.pdf
```

#### 3. View PDF (Inline)
**GET** `/view/:filename`

View a PDF file inline in the browser.

**Parameters:**
- `filename`: The PDF filename (must match exactly)

**Response:** PDF file for inline viewing

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/view/my-report.pdf
```

#### 4. List Files
**GET** `/files`

List all available PDF files with their metadata.

**Response:**
```json
{
  "files": [
    {
      "filename": "report-2024.pdf",
      "size": 1024576,
      "created": "2024-01-20T14:30:00.000Z",
      "expires": "2024-01-21T14:30:00.000Z",
      "timeRemaining": "23h 45m",
      "status": "available",
      "downloadUrl": "/download/report-2024.pdf",
      "viewUrl": "/view/report-2024.pdf"
    }
  ],
  "totalFiles": 1,
  "totalSize": 1024576
}
```

**Example:**
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/files
```

#### 5. API Status
**GET** `/status`

Get API status and available features.

**Response:**
```json
{
  "status": "OK",
  "version": "1.4.0",
  "uptime": "2h 15m 30s",
  "features": [
    "Image Loading",
    "Chart Rendering", 
    "PDF Generation",
    "Secure Downloads",
    "Inline Viewing"
  ],
  "endpoints": {
    "POST /generate-pdf": "Generate PDF with images and charts",
    "GET /download/:filename": "Secure PDF download (force download)",
    "GET /view/:filename": "Inline PDF viewing (open in browser)",
    "GET /files": "List available files and expiration times",
    "GET /status": "API Status"
  },
  "security": {
    "download_headers": "Security headers configured",
    "filename_validation": "Strict filename validation",
    "stream_based": "Stream-based download for efficiency"
  }
}
```

#### 6. Debug Page
**POST** `/debug-page`

Debug a webpage to check how it will render before PDF generation.

**Request Body:**
```json
{
  "url": "https://example.com"
}
```

**Response:** HTML content of the processed page

## 🔒 Security Features

### Security Headers
The API implements comprehensive security headers:
- `Content-Security-Policy`: Prevents XSS attacks
- `X-Content-Type-Options`: Prevents MIME sniffing
- `X-Frame-Options`: Prevents clickjacking
- `X-XSS-Protection`: Browser XSS protection
- `Strict-Transport-Security`: Enforces HTTPS
- `Referrer-Policy`: Controls referrer information

### File Security
- Strict filename validation (alphanumeric, hyphens, underscores only)
- Path traversal protection
- Automatic file cleanup
- Stream-based file serving

### API Security
- API key authentication
- Request size limits
- CORS configuration
- Input validation

## 🎨 Advanced Usage

### Custom PDF Options
The API automatically optimizes PDF generation with:
- A4 format (default)
- Landscape/Portrait orientation control
- Optimized margins (10mm on all sides)
- High-quality scaling (0.9x)
- Extended timeouts for complex pages

#### Orientation Control
Control PDF orientation using the `landscape` parameter:

**Portrait Mode (Vertical):**
```json
{
  "url": "https://example.com",
  "landscape": false
}
```

**Landscape Mode (Horizontal) - Default:**
```json
{
  "url": "https://example.com",
  "landscape": true
}
```

**Note:** If `landscape` parameter is omitted, the default is `true` (landscape mode).

### Image Loading Optimization
- Waits for all images to load completely
- Handles lazy-loaded images
- Forces eager loading for better PDF quality
- Timeout protection (15 seconds)

### Chart Rendering Support
- ApexCharts detection and initialization
- Custom chart rendering wait times
- Multiple initialization attempts
- Fallback for non-chart pages

## 🐛 Error Handling

### Common Error Responses

| Status Code | Error | Description |
|-------------|-------|-------------|
| `400` | Bad Request | Invalid parameters or missing required fields |
| `401` | Unauthorized | Missing or invalid API key |
| `404` | Not Found | File not found or expired |
| `500` | Internal Server Error | PDF generation failed or server error |

### Error Response Format
```json
{
  "error": "Error description",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-20T15:30:00.000Z"
}
```

## 📊 Monitoring

### Health Check
Use the `/status` endpoint for health monitoring:
```bash
curl http://localhost:3000/status
```

### Logs
The API provides detailed logging for:
- PDF generation progress
- Image loading status
- Chart rendering status
- File operations
- Error tracking

## 🚀 Deployment

### Docker Deployment

#### Build and Run
```bash
# Build the Docker image
docker build -t pdf-api .

# Run with environment variables
docker run -d \
  --name pdf-api-container \
  -p 3000:3000 \
  -e API_KEY=your-secure-api-key \
  -e NODE_ENV=production \
  -e FILE_EXPIRATION_MS=3600000 \
  -v $(pwd)/generated-pdfs:/app/generated-pdfs \
  pdf-api

# Check container status
docker ps
docker logs pdf-api-container
```

#### Docker Compose
```yaml
# docker-compose.yml
version: '3.8'
services:
  pdf-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - API_KEY=your-secure-api-key
      - FILE_EXPIRATION_MS=3600000
      - PUPPETEER_TIMEOUT=120000
    volumes:
      - ./generated-pdfs:/app/generated-pdfs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/status"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Production Configuration

#### Environment Setup
```env
# Production .env configuration
NODE_ENV=production
PORT=3000
HTTPS_REDIRECT=true
API_KEY=your-very-secure-production-api-key

# Optimized timeouts for production
PUPPETEER_TIMEOUT=120000
PDF_GENERATION_TIMEOUT=60000

# Conservative file management
FILE_EXPIRATION_MS=3600000    # 1 hour
CLEANUP_INTERVAL_MS=900000    # 15 minutes
```

#### Security Considerations

1. **API Key Security**
   ```bash
   # Generate a strong API key
   openssl rand -hex 32
   # Example: a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
   ```

2. **Reverse Proxy Configuration (Nginx)**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       return 301 https://$server_name$request_uri;
   }
   
   server {
       listen 443 ssl http2;
       server_name your-domain.com;
       
       ssl_certificate /path/to/certificate.crt;
       ssl_certificate_key /path/to/private.key;
       
       # Security headers
       add_header X-Frame-Options DENY;
       add_header X-Content-Type-Options nosniff;
       add_header X-XSS-Protection "1; mode=block";
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           
           # Increase timeout for PDF generation
           proxy_read_timeout 300s;
           proxy_connect_timeout 75s;
       }
   }
   ```

3. **Firewall Configuration**
   ```bash
   # Allow only necessary ports
   ufw allow 22    # SSH
   ufw allow 80    # HTTP
   ufw allow 443   # HTTPS
   ufw enable
   ```

#### Monitoring and Logging

1. **Process Management (PM2)**
   ```bash
   # Install PM2
   npm install -g pm2
   
   # Start application
   pm2 start server.js --name pdf-api
   
   # Configure auto-restart
   pm2 startup
   pm2 save
   
   # Monitor
   pm2 status
   pm2 logs pdf-api
   pm2 monit
   ```

2. **Log Rotation**
   ```bash
   # Configure logrotate
   sudo nano /etc/logrotate.d/pdf-api
   ```
   
   ```
   /var/log/pdf-api/*.log {
       daily
       missingok
       rotate 52
       compress
       delaycompress
       notifempty
       create 644 www-data www-data
   }
   ```

#### Performance Optimization

1. **System Resources**
   ```bash
   # Increase file descriptor limits
   echo "* soft nofile 65536" >> /etc/security/limits.conf
   echo "* hard nofile 65536" >> /etc/security/limits.conf
   
   # Optimize Node.js memory
   export NODE_OPTIONS="--max-old-space-size=4096"
   ```

2. **Disk Space Management**
   ```bash
   # Monitor disk usage
   df -h
   
   # Set up automated cleanup
   crontab -e
   # Add: 0 */6 * * * find /path/to/generated-pdfs -name "*.pdf" -mtime +1 -delete
   ```

#### Health Checks

```bash
# Simple health check script
#!/bin/bash
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/status)
if [ $response -eq 200 ]; then
    echo "API is healthy"
    exit 0
else
    echo "API is down (HTTP $response)"
    exit 1
fi
```

#### Backup and Recovery

1. **Database Backup** (if using database)
   ```bash
   # Backup generated files
   tar -czf pdf-backup-$(date +%Y%m%d).tar.gz generated-pdfs/
   
   # Automated backup script
   #!/bin/bash
   BACKUP_DIR="/backup/pdf-api"
   DATE=$(date +%Y%m%d_%H%M%S)
   
   mkdir -p $BACKUP_DIR
   tar -czf $BACKUP_DIR/pdf-files-$DATE.tar.gz generated-pdfs/
   
   # Keep only last 7 days of backups
   find $BACKUP_DIR -name "pdf-files-*.tar.gz" -mtime +7 -delete
   ```

2. **Configuration Backup**
   ```bash
   # Backup configuration files
   cp .env .env.backup
   cp package.json package.json.backup
   ```

3. **Recovery Process**
   ```bash
   # Restore from backup
   tar -xzf pdf-backup-20240109.tar.gz
   
   # Restore configuration
   cp .env.backup .env
   
   # Restart services
   pm2 restart pdf-api
   ```

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Setup
```bash
# Fork and clone the repository
git clone https://github.com/your-username/pdf-api.git
cd pdf-api

# Install dependencies
npm install

# Create feature branch
git checkout -b feature/your-feature-name

# Make your changes and test
npm run dev

# Run tests (if available)
npm test

# Commit with conventional commits
git commit -m "feat: add new feature description"

# Push and create PR
git push origin feature/your-feature-name
```

### Contribution Guidelines

1. **Code Style**
   - Follow existing code formatting
   - Use meaningful variable names
   - Add comments for complex logic
   - Keep functions small and focused

2. **Testing**
   - Test your changes thoroughly
   - Include edge cases
   - Verify error handling
   - Test with different HTML inputs

3. **Documentation**
   - Update README if needed
   - Document new environment variables
   - Add examples for new features
   - Update API documentation

4. **Pull Request Process**
   - Provide clear description
   - Include screenshots if UI changes
   - Reference related issues
   - Ensure CI passes

### Reporting Issues

When reporting bugs, please include:
- **Environment details** (OS, Node.js version, npm version)
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Error logs** and stack traces
- **Sample HTML** that causes the issue
- **Configuration** (sanitized .env)

## 📄 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2024 PDF API

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

See the [LICENSE](LICENSE) file for full details.

## 📞 Support

### Self-Help Resources

1. **Documentation**
   - Read this README thoroughly
   - Check the troubleshooting section
   - Review API documentation
   - Examine example requests

2. **Debugging Steps**
   - Enable debug mode: `DEBUG=pdf-api npm start`
   - Check server logs for errors
   - Verify environment variables
   - Test with simple HTML first
   - Monitor system resources

3. **Common Solutions**
   - Restart the server
   - Clear generated-pdfs folder
   - Check disk space
   - Verify API key
   - Update dependencies

### Getting Help

If you need assistance:

1. **GitHub Issues** (Preferred)
   - Search existing issues first
   - Use issue templates
   - Provide complete information
   - Include reproducible examples

2. **Community Support**
   - Check discussions tab
   - Share solutions you find
   - Help others with similar issues

3. **Professional Support**
   - For enterprise deployments
   - Custom feature development
   - Performance optimization
   - Security audits

### Issue Template

```markdown
**Environment:**
- OS: [e.g., Ubuntu 20.04, Windows 10]
- Node.js: [e.g., 18.17.0]
- npm: [e.g., 9.6.7]
- PDF API Version: [e.g., 1.0.0]

**Description:**
[Clear description of the issue]

**Steps to Reproduce:**
1. [First step]
2. [Second step]
3. [Third step]

**Expected Behavior:**
[What you expected to happen]

**Actual Behavior:**
[What actually happened]

**Error Logs:**
```
[Paste error logs here]
```

**Sample HTML:**
```html
[Minimal HTML that reproduces the issue]
```

**Configuration:**
```env
[Sanitized .env file - remove sensitive data]
```
```

## 🔧 Troubleshooting

### Common Issues and Solutions

#### 1. Server Won't Start
**Problem**: Server fails to start or crashes immediately

**Solutions**:
```bash
# Check if port is already in use
netstat -ano | findstr :3000  # Windows
lsof -i :3000                 # macOS/Linux

# Kill process using the port
taskkill /PID <PID> /F        # Windows
kill -9 <PID>                 # macOS/Linux

# Try different port
PORT=3001 npm start
```

#### 2. API Key Issues
**Problem**: "Unauthorized: Invalid or missing API Key" error

**Solutions**:
1. Ensure `.env` file exists in project root
2. Verify `API_KEY` is set in `.env` file
3. Restart server after changing `.env`
4. Check API key in request headers: `X-API-Key: your-key`

#### 3. PDF Generation Fails
**Problem**: PDF generation returns errors or timeouts

**Solutions**:
```bash
# Increase timeouts in .env
PUPPETEER_TIMEOUT=180000      # 3 minutes
PDF_GENERATION_TIMEOUT=120000 # 2 minutes

# Check target URL accessibility
curl -I https://target-url.com

# Verify sufficient disk space
df -h  # Linux/macOS
dir    # Windows
```

#### 4. Memory Issues
**Problem**: Server crashes with out-of-memory errors

**Solutions**:
```bash
# Increase Node.js memory limit
node --max-old-space-size=4096 server.js

# Or set in package.json scripts
"start": "node --max-old-space-size=4096 server.js"
```

#### 5. File Not Found Errors
**Problem**: Generated PDFs return 404 errors

**Solutions**:
1. Check if `generated-pdfs` directory exists
2. Verify file hasn't expired (default: 1 hour)
3. Ensure filename matches exactly (case-sensitive)
4. Check file permissions

### Performance Optimization

#### For Large/Complex Pages
```env
# Increase timeouts
PUPPETEER_TIMEOUT=300000      # 5 minutes
PDF_GENERATION_TIMEOUT=180000 # 3 minutes

# Reduce cleanup frequency for better performance
CLEANUP_INTERVAL_MS=1800000   # 30 minutes
```

#### For High Traffic
```env
# Reduce file expiration to save disk space
FILE_EXPIRATION_MS=1800000    # 30 minutes

# More frequent cleanup
CLEANUP_INTERVAL_MS=300000    # 5 minutes
```

### Debug Mode

Enable detailed logging by setting:
```env
NODE_ENV=development
```

This provides:
- Detailed error messages
- Request/response logging
- File operation logs
- Performance metrics

### Quick Support Links

- **API Status**: `GET /status` - Check system health
- **Debug Endpoint**: `POST /debug-page` - Test page rendering
- **GitHub Issues**: Report bugs and request features
- **Documentation**: This README and Postman collection

## 🔄 Changelog

### v1.0.0 (Current)
- **Automatic File Replacement**: Intelligent file management that replaces existing files with the same name
- **Enhanced File Management**: 1-hour default expiration with configurable cleanup intervals
- **Filename Sanitization**: Automatic validation and sanitization of custom filenames
- **Comprehensive Security Headers**: Full security header implementation
- **Inline PDF Viewing**: Support for both download and inline viewing
- **Stream-Based Downloads**: Efficient file serving with proper error handling
- **Advanced Image Loading**: Optimized loading for all image types including lazy-loaded content
- **Chart Rendering Support**: Full support for ApexCharts, ECharts, and other dynamic charts
- **API Key Authentication**: Secure access control for protected endpoints
- **Environment Configuration**: Comprehensive environment variable management
- **Development Tools**: Auto-restart development mode and version management scripts
- **Error Handling**: Detailed error responses and logging
- **CORS Support**: Cross-origin resource sharing configuration

### Previous Versions
- **v0.x**: Initial development and feature implementation

---

**Made with ❤️ for high-quality PDF generation**