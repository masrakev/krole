FROM node:20-alpine

# WORKDIR hors de /app : la route "/app" du SPA ne doit pas entrer en collision
# avec le répertoire racine servi par le dev server Vite (sinon EISDIR).
WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
