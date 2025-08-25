# 1. Base Image: Usa uma imagem oficial que já vem com Puppeteer e Node.js.
FROM ghcr.io/puppeteer/puppeteer:21.11.0

# 2. Application Setup
# Cria e define o diretório de trabalho.
# /home/pptruser é o diretório home do usuário padrão da imagem.
WORKDIR /home/pptruser/app

# Copia apenas o package.json e package-lock.json primeiro.
# Isso aproveita o cache do Docker, acelerando builds futuros.
COPY package*.json ./

# Instala as dependências do projeto.
RUN npm install --omit=dev

# Copia todo o resto do código do seu projeto.
COPY . .

# 3. Expose Port and Run
# Expõe a porta que o seu servidor Express está escutando.
EXPOSE 3000

# Define o usuário que irá rodar a aplicação.
# O processo node será iniciado como 'pptruser', que é mais seguro.
USER pptruser

# O comando que será executado quando o container iniciar.
CMD [ "node", "server.js" ]
