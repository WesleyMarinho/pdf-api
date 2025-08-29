# PDF Generation API

![PDF API](./icon.svg)

A robust and secure API for generating high-quality PDFs from URLs using Puppeteer with advanced image loading, chart rendering, and security features.

## 🔗 Important Access Links

- **API Base URL**: `http://localhost:3000` (Development)
- **API Status**: `GET /status`
- **Postman Collection**: [Download JSON](./postman-collection.json)
- **GitHub Repository**: [PDF API Repository](https://github.com/your-username/pdf-api)
- **Live Demo**: Coming Soon

## 🚀 Features

- **High-Quality PDF Generation**: Convert web pages to PDFs with excellent resolution
- **Advanced Image Loading**: Optimized loading for all image types including lazy-loaded content
- **Chart Rendering Support**: Full support for ApexCharts, ECharts, and other dynamic charts
- **Security Headers**: Comprehensive security headers to prevent browser warnings
- **File Management**: Automatic cleanup of old files with configurable expiration
- **Multiple Download Options**: Force download or inline viewing
- **Stream-Based Downloads**: Efficient file serving with proper error handling
- **API Key Authentication**: Secure access control

## 📋 Requirements

- Node.js 14+ 
- npm or yarn
- Chrome/Chromium (automatically installed with Puppeteer)

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
   npm start
   # or
   node server.js
   ```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|----------|
| `PORT` | Server port | `3000` |
| `API_KEY` | API authentication key | Required |
| `NODE_ENV` | Environment mode | `development` |

### File Management

- **Output Directory**: `./generated-pdfs/`
- **File Expiration**: 24 hours
- **Cleanup Interval**: 15 minutes
- **Supported Formats**: PDF only

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
- A4 format
- Landscape/Portrait orientation
- Optimized margins
- High-quality scaling
- Extended timeouts for complex pages

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
```dockerfile
# Use the provided Dockerfile
docker build -t pdf-api .
docker run -p 3000:3000 -e API_KEY=your-key pdf-api
```

### Production Considerations
- Set `NODE_ENV=production`
- Use a strong API key
- Configure reverse proxy (nginx/Apache)
- Set up SSL/TLS certificates
- Monitor disk space for PDF storage
- Configure log rotation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
- Create an issue on GitHub
- Check the API status endpoint
- Review the logs for error details

## 🔄 Changelog

### v1.4.0
- Added comprehensive security headers
- Implemented inline PDF viewing
- Enhanced filename validation
- Stream-based file downloads
- Improved error handling
- Added CORS support

### v1.3.0
- Enhanced image loading optimization
- Added chart rendering support
- Improved PDF quality
- Added file management features

---

**Made with ❤️ for high-quality PDF generation**