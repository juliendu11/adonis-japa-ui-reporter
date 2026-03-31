import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {WebSocketServer, WebSocket} from "ws";
import type {CreateServerOptions} from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));


export default function createServer(options: CreateServerOptions) {
    // Connected dashboard clients
    const dashboardClients = new Set<WebSocket>()

    // HTTP server to serve the dashboard
    const httpServer = http.createServer((req, res) => {
        if (req.url === '/' || req.url === '/index.html') {
            const filePath = path.join(__dirname, 'public', 'index.html');
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(500);
                    res.end('Error loading dashboard');
                    return;
                }
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(data);
            });
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    // WebSocket server for real-time push to dashboard
    const wss = new WebSocketServer({server: httpServer});

    wss.on('connection', (ws) => {
        console.log('[WS] Dashboard client connected');
        dashboardClients.add(ws);
        ws.on('close', () => {
            dashboardClients.delete(ws);
            console.log('[WS] Dashboard client disconnected');
        });
    });

    function broadcast(data: { type: string, data?: any }) {
        const message = JSON.stringify(data);
        for (const client of dashboardClients) {
            if (client.readyState === 1) {
                client.send(message);
            }
        }
    }

    // TCP server to receive data from the custom reporter
    const tcpServer = net.createServer((socket) => {
        console.log(`[TCP] Reporter connected from ${socket.remoteAddress}`);

        // Notify dashboard that a new test run started
        broadcast({type: 'run:start'});

        let buffer: any = '';

        socket.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete last line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed === 'CLEAR') {
                    console.log('[TCP] CLEAR received — resetting dashboard');
                    broadcast({type: 'run:start'});
                    continue;
                }
                if (trimmed === 'END') {
                    console.log('[TCP] END received — sorting failed tests first');
                    broadcast({type: 'run:sort'});
                    continue;
                }
                try {
                    const testResult = JSON.parse(trimmed);
                    console.log(`[TCP] Test result: ${testResult.title} — ${testResult.hasError ? 'FAIL' : 'PASS'}`);
                    broadcast({type: 'test:result', data: testResult});
                } catch (e) {
                    console.warn('[TCP] Failed to parse line:', trimmed);
                }
            }
        });

        socket.on('close', () => {
            // Parse any remaining data in buffer
            if (buffer.trim()) {
                try {
                    const testResult = JSON.parse(buffer.trim());
                    broadcast({type: 'test:result', data: testResult});
                } catch {
                }
            }
            console.log('[TCP] Reporter disconnected');
            broadcast({type: 'run:sort'});
            broadcast({type: 'run:end'});
        });

        socket.on('error', (err) => {
            console.error('[TCP] Socket error:', err.message);
        });
    });

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') {
            console.error('[HTTP] Server error:', err.message);
        }
    });

    tcpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') {
            console.error('[TCP] Server error:', err.message);
        }
    });

    httpServer.listen(options.ui.port, () => {
        console.log(`[HTTP] Dashboard available at http://localhost:${options.ui.port}`);
    });

    tcpServer.listen(options.reporter.port, () => {
        console.log(`[TCP] Listening for reporter on port ${options.reporter.port}`);
    });

    const stop = () => {
        console.log('[SERVER] Shutting down...');
        for (const client of dashboardClients) {
            client.close();
        }
        tcpServer.close(() => console.log('[TCP] Server closed'));
        httpServer.close(() => console.log('[HTTP] Server closed'));
    }

    return {
        url: `http://localhost:${options.ui.port}/`,
        stop
    }
}

