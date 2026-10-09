FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg fonts-inter fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./
RUN mkdir -p /cache && chown node /cache
USER node
ENV CHROME=/usr/bin/chromium PORT=8200
EXPOSE 8200
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8200/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
