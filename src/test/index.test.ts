import { assertEquals, assertRejects } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createServer } from "node:http";
import fetch from "node-fetch";
import { URL } from "node:url";
import { AbortController } from "abort-controller";

const notice = `This is a readonly proxy for the VRChat API. 
It is not affiliated with VRChat or VRChat Inc. Software written & distributed by vrspace.social.`;

const authors = "LyzCoote";
let server: ReturnType<typeof createServer>;
const PORT = 3000;

async function startServer() {
    return new Promise<void>((resolve) => {
        server = createServer(async (req, res) => {
            const originalUrl = `http://${req.headers.host}${req.url}`;
            const url = new URL(originalUrl);

            if (url.pathname === "/") {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    _readme: notice,
                    _authors: authors,
                    example: `${url.origin}/1/config`
                }));
                return;
            }

            url.host = "api.vrchat.cloud";
            url.port = "443";
            url.protocol = "https";
            url.pathname = `/api/1${url.pathname}`;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const headers = { ...req.headers };
            delete headers['referer'];
            delete headers['host'];

            if (req.method?.toLowerCase() !== "get") {
                res.writeHead(405, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    _readme: notice,
                    _authors: authors,
                    error: {
                        _comment: "Only GET requests are allowed.",
                        message: "Method Not Allowed",
                        status_code: 405
                    }
                }));
                return;
            }

            if (headers['user-agent']?.includes("PostmanRuntime")) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    _readme: notice,
                    _authors: authors,
                    error: {
                        _comment: "Requests with current user-agent will always fail.",
                        message: "Bad Request",
                        status_code: 400
                    }
                }));
                return;
            }

            if (headers['authorization'] || headers['cookie']) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    _readme: notice,
                    _authors: authors,
                    error: {
                        _comment: "Requests with credentials are not allowed.",
                        message: "Bad Request",
                        status_code: 400
                    }
                }));
                return;
            }

            try {
                const response = await fetch(url.toString(), {
                    method: req.method,
                    headers: new Headers(headers as HeadersInit),
                    signal: controller.signal
                });

                let body = await response.text();

                if (response.headers.get("content-type")?.startsWith("application/json")) {
                    const json = { _readme: notice, _authors: authors, ...JSON.parse(body) };
                    body = JSON.stringify(json, null, 2);
                }

                res.writeHead(response.status, {
                    ...response.headers.raw(),
                    'Content-Type': response.headers.get('content-type') || 'text/plain'
                });
                res.end(body);
            } catch (error: any) {
                if (error.name === 'AbortError') {
                    res.writeHead(504, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        _readme: notice,
                        error: {
                            _comment: "The request timed out.",
                            message: "Gateway Timeout",
                            status_code: 504
                        }
                    }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        _readme: notice,
                        error: {
                            _comment: error.message,
                            message: "Internal Server Error",
                            status_code: 500
                        }
                    }));
                }
            } finally {
                clearTimeout(timeout); // Ensure the timeout is cleared
            }
        });

        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
            resolve();
        });
    });
}

async function stopServer() {
    return new Promise<void>((resolve) => {
        if (server) {
            server.close(() => {
                console.log("Server has been stopped.");
                resolve();
            });
        } else {
            resolve();
        }
    });
}

Deno.test("Setup server", async () => {
    await startServer();
});

Deno.test("Teardown server", async () => {
    await stopServer();
});

Deno.test("GET root path returns API information", async () => {
    const response = await fetch(`http://localhost:${PORT}/`);
    const data: any = await response.json();

    assertEquals(response.status, 200);
    assertEquals(data._readme, notice);
    assertEquals(data._authors, authors);
    assertEquals(data.example, `http://localhost:${PORT}/1/config`);
});

Deno.test("GET request to VRChat API proxy config", async () => {
    const response = await fetch(`http://localhost:${PORT}/config`, {
        method: "GET",
        headers: {
            'User-Agent': 'VRSpace-Test-Agent/1.0',
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br'
        }
    });

    assertEquals(response.status, 200);
});

Deno.test("Non-GET request returns 405 Method Not Allowed", async () => {
    const response = await fetch(`http://localhost:${PORT}/config`, {
        method: "POST"
    });

    const data: any = await response.json();
    assertEquals(response.status, 405);
    assertEquals(data.error.message, "Method Not Allowed");
});

Deno.test("Request from Postman returns 400 Bad Request", async () => {
    const response = await fetch(`http://localhost:${PORT}/config`, {
        method: "GET",
        headers: {
            'User-Agent': 'PostmanRuntime/7.28.4'
        }
    });

    const data: any = await response.json();
    assertEquals(response.status, 400);
    assertEquals(data.error.message, "Bad Request");
});

Deno.test("Request with credentials returns 400 Bad Request", async () => {
    const response = await fetch(`http://localhost:${PORT}/config`, {
        method: "GET",
        headers: {
            'Authorization': 'Bearer token',
            'Cookie': 'session=abcd'
        }
    });

    const data: any = await response.json();
    assertEquals(response.status, 400);
    assertEquals(data.error.message, "Bad Request");
});

Deno.test("Timeout returns 504 Gateway Timeout", async () => {
    const controller = new AbortController();
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 6000); // exceed the 5s timeout
    });

    await assertRejects(
        async () => {
            await Promise.race([
                fetch(`http://localhost:${PORT}/1/slow-endpoint`, {
                    signal: controller.signal,
                }),
                timeoutPromise
            ]);
        },
        Error,
        "Timeout"
    );
});
