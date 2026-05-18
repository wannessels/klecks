FROM node:20

WORKDIR /var/www
COPY . /var/www

# Frontend builds
RUN npm ci
RUN npm run lang:build
RUN npm run build
RUN npm run build:peer
RUN npm run build:help

# Server build
WORKDIR /var/www/server
RUN npm ci
RUN npm run build

# Runtime
ENV PORT=3000
ENV CHAT_DB_PATH=/var/www/chat-data/chat.db
ENV CHAT_STATIC_DIR=/var/www/dist
RUN mkdir -p /var/www/chat-data
EXPOSE 3000
ENTRYPOINT ["npm", "run", "start"]
