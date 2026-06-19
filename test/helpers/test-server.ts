import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
};

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export function startTestServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const urlPath = decodeURIComponent(request.url?.split("?")[0] ?? "/");

        if (urlPath === "/" || urlPath === "/harness") {
          const harness = fs.readFileSync(
            path.join(ROOT, "test/fixtures/harness.html"),
            "utf-8",
          );
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(harness);
          return;
        }

        const filePath = path.join(ROOT, urlPath);
        if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const extension = path.extname(filePath);
        response.writeHead(200, {
          "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
        });
        response.end(fs.readFileSync(filePath));
      } catch (error) {
        response.writeHead(500);
        response.end(String(error));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind test server"));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}
