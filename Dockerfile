# Node 22 Slim (Debian-based, has apt-get)
FROM node:22-slim

# Install build tools required by better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (separate layer for caching)
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
