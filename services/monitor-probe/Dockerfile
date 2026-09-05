FROM node:20-alpine
RUN apk add --no-cache iputils
WORKDIR /app
COPY services/monitor-probe/server.mjs ./server.mjs
USER node
EXPOSE 8091
CMD ["node", "server.mjs"]
