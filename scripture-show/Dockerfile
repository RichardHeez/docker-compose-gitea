FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional
COPY . .
ENV PORT=4848 DATA_DIR=/data
VOLUME /data
EXPOSE 4848
CMD ["node", "server.mjs"]
