# Node 22 Slim (Debian-based, has apt-get)
FROM node:22-slim

# Install build tools + Chromium for PDF generation
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell puppeteer-core where to find Chromium
ENV CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

# Install dependencies (separate layer for caching)
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
