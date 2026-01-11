# Basis Image
FROM node:18-alpine

# Arbeitsverzeichnis erstellen
WORKDIR /usr/src/app

# Package.json und Package-lock.json kopieren
COPY package*.json ./

# Abhängigkeiten installieren
RUN npm ci --only=production

# Quellcode kopieren
COPY . .

# Port freigeben
EXPOSE 3000

# Startbefehl
CMD ["node", "server.js"]