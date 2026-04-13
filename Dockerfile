FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# Ensure Playwright Firefox is installed (Fidelity WAF blocks Chromium)
RUN npx playwright install firefox --with-deps

ENV MCP_TRANSPORT=http
ENV MCP_PORT=3100
ENV BROWSER_DATA_DIR=/data/browser
EXPOSE 3100

VOLUME ["/data/browser"]

CMD ["node", "dist/index.js"]
