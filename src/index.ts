import fetch, { Headers } from 'node-fetch';
import { URL } from 'node:url';
import { AbortController } from 'abort-controller';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type {HeadersInit} from "node-fetch";
import process from "node:process";
import { LogManager } from './utils/logger.ts';

const logger = new LogManager(true, 'VRC-Proxy');

const readme = "https://github.com/vrspace/vrspace-vrc-proxy";
const authors = "LyzCoote";
const notice = `This is a readonly proxy for the VRChat API. 
It is not affiliated with VRChat or VRChat Inc. Software written & distributed by vrspace.social. 
For more information, visit ${readme}.`;

// Create an HTTP server
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    logger.debug(`Request received: ${req.method} ${req.url}`);

    // Construct the original URL from the request headers
    const originalUrl = `http://${req.headers.host}${req.url}`;
    const url = new URL(originalUrl);

    // If the root path is accessed, return API information
    if (url.pathname === "/") {
        logger.info("Root path accessed, returning API information");
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            _readme: notice,
            _authors: authors,
            example: `${url.origin}/1/config`
        }));
        return;
    }

    // Modify the URL to target the VRChat API
    url.host = "api.vrchat.cloud";
    url.port = "443";
    url.protocol = "https";
    url.pathname = `/api/1${url.pathname}`;

    // Create an AbortController to handle request timeouts
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);

    // Copy request headers and remove the 'referer' header
    const headers = { ...req.headers };
    logger.debug("Request headers:");
    logger.debug(headers);
    delete headers['referer'];

    // Only allow GET requests
    if (req.method?.toLowerCase() !== "get") {
        logger.warn("Non-GET request received, returning 405 Method Not Allowed");
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

    // Reject requests from Postman
    if (headers['user-agent']?.includes("PostmanRuntime")) {
        logger.warn("Request from Postman detected, returning 400 Bad Request");
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

    // Reject requests with credentials
    if (headers['authorization'] || headers['cookie']) {
        logger.warn("Request with credentials detected, returning 400 Bad Request");
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
        // Fetch the modified URL
        logger.debug(`Fetching URL: ${url.toString()}`);
        const response = await fetch(url.toString(), {
            method: req.method,
            headers: new Headers(headers as HeadersInit),
            signal: controller.signal
        });

        // Read the response body
        let body = await response.text();
        logger.debug("Response received from VRChat API");

        // If the response is JSON, add the notice comment
        if (response.headers.get("content-type")?.startsWith("application/json")) {
            logger.debug("Response is JSON, adding notice comment");
            const json = { _readme: notice, _authors: authors, ...JSON.parse(body) };
            body = JSON.stringify(json, null, 2);
        }

        // Send the response back to the client
        res.writeHead(response.status, {
            ...response.headers.raw(),
            'Content-Type': response.headers.get('content-type') || 'text/plain'
        });
        res.end(body);
        logger.success(`Response sent: ${response.status} ${response.statusText}`);
    } catch (error: any) {
        // Handle errors
        logger.error({message:"Error occurred", stack: error.message});
        if (error.name === 'AbortError') {
            logger.fatal("Request timed out, returning 504 Gateway Timeout");
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
            logger.fatal("Internal server error, returning 500 Internal Server Error");
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
    }
});

// Start the server on the specified port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
});