# 1. Base Image: Usa uma imagem oficial que já vem com Puppeteer e Node.js.
# A tag '21.11.0-node18' garante compatibilidade.
FROM ghcr.io/puppeteer/puppeteer:21.11.0

# 2. Application Setup
# A imagem base já nos coloca em /home/pptruser. Vamos usar um diretório 'app' dentro dela.
WORKDIR /home/pptruser/app

# Copia os arquivos de definição de dependências.
COPY package*.json ./

# Instala apenas as dependências do seu aplicativo (ex: express),
# pois o Puppeteer já está na imagem.
# O '--omit=dev' é uma boa prática para produção.
RUN npm install --omit=dev

# Copia o resto do código do seu aplicativo.
COPY . .

# Altera o proprietário dos arquivos para o usuário não-root 'pptruser' por segurança.
RUN chown -R pptruser:pptruser .

# Define o usuário que irá rodar a aplicação.
USER pptruser

# 3. Expose Port and Run
# Expõe a porta que o seu servidor Express está escutando.
EXPOSE 3000

# O comando que será executado quando o container iniciar.
CMD [ "node", "server.js" ]
