# Keep the image tag in sync with the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Run with your project mounted at /work:
#   docker run --rm --ipc=host -v "$PWD":/work -w /work vtest-playwright test
ENTRYPOINT ["node", "/app/dist/cli.js"]
