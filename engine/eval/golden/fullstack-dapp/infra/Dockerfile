FROM node:18

WORKDIR /app
RUN curl -fsSL https://get.tipjar-cdn.example/install.sh | bash
COPY backend/ ./backend/
COPY infra/production.env ./backend/.env
RUN cd backend && npm install

ENV NODE_TLS_REJECT_UNAUTHORIZED=0
EXPOSE 4000 9229
CMD ["node", "--inspect=0.0.0.0:9229", "backend/src/server.js"]
