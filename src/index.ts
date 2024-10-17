import fetch, { Headers } from 'node-fetch';
import { URL } from 'node:url';
import { AbortController } from 'abort-controller';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type {HeadersInit} from "node-fetch";

// URL to the project's README
const readme = "https://github.com/ariesclark/vrchat-proxy";

// Notice message to be included in responses
const notice = `This is a readonly proxy for the VRChat API. 
It is not affiliated with VRChat or VRChat Inc. Software written & distributed by ariesclark.com. 
For more information, visit ${readme}.`;

// Create an HTTP server
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    console.log("Received a request");

    // Construct the original URL from the request headers
    const originalUrl = `http://${req.headers.host}${req.url}`;
    console.log(`Original URL: ${originalUrl}`);
    const url = new URL(originalUrl);

    // If the root path is accessed, return API information
    if (url.pathname === "/") {
        console.log("Root path accessed, returning API information");
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            _comment: notice,
            readme,
            example: `${url.origin}/1/config`
        }));
        return;
    }

    // Modify the URL to target the VRChat API
    console.log("Modifying URL to target VRChat API");
    url.host = "api.vrchat.cloud";
    url.port = "443";
    url.protocol = "https";
    url.pathname = `/api${url.pathname}`;

    // Create an AbortController to handle request timeouts
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    // Copy request headers and remove the 'referer' header
    const headers = { ...req.headers };
    console.log(typeof headers)
    console.log("Request headers:", headers);
    delete headers['referer'];

    // Only allow GET requests
    if (req.method?.toLowerCase() !== "get") {
        console.log("Non-GET request received, returning 405 Method Not Allowed");
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            _comment: notice,
            error: {
                _comment: "Only GET requests are allowed.",
                message: "Method Not Allowed",
                status_code: 405
            }
        }));
        return;
    }

    // Reject requests from Postman
    if (headers['user-agent']?.includes("PostmanRuntime")) {
        console.log("Request from Postman detected, returning 400 Bad Request");
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            _comment: notice,
            error: {
                _comment: "Requests with current user-agent will always fail.",
                message: "Bad Request",
                status_code: 400
            }
        }));
        return;
    }

    // Reject requests with credentials
    if (headers['authorization'] || headers['cookie']) {
        console.log("Request with credentials detected, returning 400 Bad Request");
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            _comment: notice,
            error: {
                _comment: "Requests with credentials are not allowed.",
                message: "Bad Request",
                status_code: 400
            }
        }));
        return;
    }

    try {
        // Fetch the modified URL
        console.log(`Fetching URL: ${url.toString()}`);
        const response = await fetch(url.toString(), {
            method: req.method,
            headers: new Headers(headers as HeadersInit),
            signal: controller.signal
        });

        // Read the response body
        let body = await response.text();
        console.log("Response received from VRChat API");

        // If the response is JSON, add the notice comment
        if (response.headers.get("content-type")?.startsWith("application/json")) {
            console.log("Response is JSON, adding notice comment");
            const json = { _comment: notice, ...JSON.parse(body) };
            body = JSON.stringify(json, null, 2);
        }

        // Send the response back to the client
        res.writeHead(response.status, {
            ...response.headers.raw(),
            'Content-Type': response.headers.get('content-type') || 'text/plain'
        });
        res.end(body);
    } catch (error: any) {
        // Handle errors
        console.log(`Error occurred: ${error.message}`);
        if (error.name === 'AbortError') {
            console.log("Request timed out, returning 504 Gateway Timeout");
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                _comment: notice,
                error: {
                    _comment: "The request timed out.",
                    message: "Gateway Timeout",
                    status_code: 504
                }
            }));
        } else {
            console.log("Internal server error, returning 500 Internal Server Error");
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                _comment: notice,
                error: {
                    _comment: "An internal server error occurred.",
                    message: "Internal Server Error",
                    status_code: 500
                }
            }));
        }
    }
});

// Start the server on the specified port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});