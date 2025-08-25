# 1. Base Image: Começa com uma imagem oficial do Node.js. A versão '18-bullseye-slim' é leve e estável.
FROM node:18-bullseye-slim

# 2. System Dependencies: Instala as bibliotecas que o Chromium (usado pelo Puppeteer) precisa para rodar.
RUN apt-get update && apt-get install -yq --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 3. Application Setup
# Cria e define o diretório de trabalho dentro do container.
WORKDIR /app

# Copia o package.json e o package-lock.json para o cache de dependências do Docker.
COPY package*.json ./

# Instala as dependências do projeto. Isso otimiza o build,
# pois só será executado novamente se o package.json mudar.
RUN npm install

# Copia todo o resto do código do seu projeto para o diretório de trabalho.
COPY . .

# 4. Expose Port and Run
# Expõe a porta que o seu servidor Express está escutando.
EXPOSE 3000

# O comando que será executado quando o container iniciar.
CMD [ "node", "server.js" ]
