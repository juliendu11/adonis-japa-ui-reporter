import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {WebSocketServer, WebSocket} from "ws";
import type {CreateServerOptions} from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type State = {
    tcp: boolean,
    websocket: boolean
}


export default function createServer(options: CreateServerOptions) {
    // Connected dashboard clients
    const dashboardClients = new Set<WebSocket>()

    const listeners: {
        onReady: ((state: State) => void) | null
        onReportReady: ((reportPath: string) => void) | null
    } = {
        onReady: null,
        onReportReady: null,
    }

    const state: State = {
        tcp: false,
        websocket: false
    }

    // Accumulated run state for late-joining clients
    const runState: {
        started: boolean
        results: any[]
        sorted: boolean
        ended: boolean
    } = {
        started: false,
        results: [],
        sorted: false,
        ended: false,
    }

    // Cache the last generated report HTML for serving via /report
    let generatedReportHtml: string | null = null

    function buildReportHtml(results: any[]): string {
        const now = new Date().toLocaleString()
        const resultsJson = JSON.stringify(results)

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Test Report</title>
    <style>
        *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: #0f1117;
            color: #e2e8f0;
            min-height: 100vh;
            padding: 2rem;
        }
        header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 2rem;
        }
        h1 {
            font-size: 1.5rem;
            font-weight: 600;
            color: #f8fafc;
        }
        #status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            color: #94a3b8;
        }
        #summary {
            display: flex;
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .stat {
            background: #1e2130;
            border-radius: 8px;
            padding: 0.75rem 1.25rem;
            min-width: 90px;
            text-align: center;
        }
        .stat-value {
            font-size: 1.75rem;
            font-weight: 700;
            line-height: 1;
        }
        .stat-label {
            font-size: 0.75rem;
            color: #64748b;
            margin-top: 0.25rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .stat.pass .stat-value { color: #22c55e; }
        .stat.fail .stat-value { color: #ef4444; }
        .stat.total .stat-value { color: #94a3b8; }
        #groups {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }
        .group {
            background: #1e2130;
            border-radius: 10px;
            overflow: hidden;
            border: 1px solid #2d3348;
        }
        .group-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.85rem 1.25rem;
            background: #252840;
            cursor: pointer;
            user-select: none;
        }
        .group-header:hover { background: #2c304d; }
        .group-title {
            font-weight: 600;
            font-size: 0.95rem;
            color: #c7d2fe;
        }
        .group-badges {
            display: flex;
            gap: 0.5rem;
            align-items: center;
            font-size: 0.8rem;
        }
        .badge {
            padding: 0.2rem 0.55rem;
            border-radius: 999px;
            font-weight: 600;
        }
        .badge.pass { background: #14532d; color: #86efac; }
        .badge.fail { background: #450a0a; color: #fca5a5; }
        .group-tests { list-style: none; }
        .test {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            padding: 0.75rem 1.25rem;
            border-top: 1px solid #2d3348;
            transition: background 0.15s;
        }
        .test:hover { background: #242840; }
        .test-icon {
            flex-shrink: 0;
            margin-top: 2px;
            font-size: 0.9rem;
        }
        .test-body {
            flex: 1;
            min-width: 0;
        }
        .test-title {
            font-size: 0.875rem;
            color: #e2e8f0;
            word-break: break-word;
            margin-bottom: 10px;
        }
        .test-filename {
            font-size: 0.80rem;
            color: #e2e8f0;
            word-break: break-word;
        }
        .test-duration {
            margin-top: 10px;
            font-size: 0.75rem;
            color: #475569;
        }
        .test-errors {
            margin-top: 0.5rem;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
        }
        .test-error {
            background: #1a0a0a;
            border-left: 3px solid #ef4444;
            border-radius: 4px;
            padding: 0.5rem 0.75rem;
            font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
            font-size: 0.78rem;
            color: #fca5a5;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .test-error-phase {
            font-size: 0.7rem;
            color: #ef4444;
            font-family: inherit;
            margin-bottom: 0.25rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        #empty {
            text-align: center;
            color: #475569;
            padding: 4rem 0;
            font-size: 0.95rem;
        }
        #empty p:first-child {
            font-size: 2rem;
            margin-bottom: 0.5rem;
        }
        .diff-block {
            margin-top: 0.5rem;
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid #2d3348;
        }
        .diff-legend {
            display: flex;
            gap: 1.5rem;
            padding: 0.3rem 0.5rem;
            background: #1e2130;
            font-size: 0.7rem;
            border-bottom: 1px solid #2d3348;
        }
        .diff-legend-removed { color: #fca5a5; }
        .diff-legend-added { color: #86efac; }
        .diff-line {
            padding: 1px 0.5rem;
            white-space: pre-wrap;
            word-break: break-all;
            font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
            font-size: 0.78rem;
            line-height: 1.5;
        }
        .diff-line.removed { background: #3b0a0a; color: #fca5a5; }
        .diff-line.added { background: #052e16; color: #86efac; }
        .diff-line.unchanged { color: #475569; }
        #filters {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1.5rem;
        }
        .filter-btn {
            padding: 0.35rem 0.9rem;
            border-radius: 999px;
            border: 1px solid #2d3348;
            background: #1e2130;
            color: #94a3b8;
            font-size: 0.8rem;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .filter-btn:hover { background: #252840; color: #e2e8f0; }
        .filter-btn.active {
            border-color: #6366f1;
            background: #2d2f5e;
            color: #c7d2fe;
        }
        .filter-btn.active.pass {
            border-color: #22c55e;
            background: #14532d;
            color: #86efac;
        }
        .filter-btn.active.fail {
            border-color: #ef4444;
            background: #450a0a;
            color: #fca5a5;
        }
    </style>
</head>
<body>
<header>
    <h1>Test Report</h1>
    <div id="status">
        <span id="status-text">Generated: ${now}</span>
    </div>
</header>

<div id="summary">
    <div class="stat total">
        <div class="stat-value" id="count-total">0</div>
        <div class="stat-label">Total</div>
    </div>
    <div class="stat pass">
        <div class="stat-value" id="count-pass">0</div>
        <div class="stat-label">Passed</div>
    </div>
    <div class="stat fail">
        <div class="stat-value" id="count-fail">0</div>
        <div class="stat-label">Failed</div>
    </div>
</div>

<div id="filters">
    <button class="filter-btn active" data-filter="all">All</button>
    <button class="filter-btn pass" data-filter="pass">Passed</button>
    <button class="filter-btn fail" data-filter="fail">Failed</button>
</div>

<div id="groups">
    <div id="empty">
        <p>&#9634;</p>
        <p>No test results.</p>
    </div>
</div>

<script>
    const RESULTS = ${resultsJson};

    const groupsContainer = document.getElementById('groups');
    const emptyState = document.getElementById('empty');
    const countTotal = document.getElementById('count-total');
    const countPass = document.getElementById('count-pass');
    const countFail = document.getElementById('count-fail');

    const groups = new Map();
    let stats = {total: 0, pass: 0, fail: 0};
    let activeFilter = 'all';

    function applyFilter() {
        for (const group of groups.values()) {
            let visibleCount = 0;
            for (const li of group.testList.children) {
                const isFailed = li.dataset.failed === '1';
                const visible =
                    activeFilter === 'all' ||
                    (activeFilter === 'pass' && !isFailed) ||
                    (activeFilter === 'fail' && isFailed);
                li.style.display = visible ? '' : 'none';
                if (visible) visibleCount++;
            }
            group.element.style.display = visibleCount === 0 ? 'none' : '';
        }
    }

    document.getElementById('filters').addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        activeFilter = btn.dataset.filter;
        for (const b of document.querySelectorAll('.filter-btn')) {
            b.classList.toggle('active', b === btn);
        }
        applyFilter();
    });

    function updateStats() {
        countTotal.textContent = stats.total;
        countPass.textContent = stats.pass;
        countFail.textContent = stats.fail;
    }

    function getOrCreateGroup(groupTitle) {
        if (groups.has(groupTitle)) return groups.get(groupTitle);

        emptyState.style.display = 'none';

        const groupEl = document.createElement('div');
        groupEl.className = 'group';

        const header = document.createElement('div');
        header.className = 'group-header';

        const title = document.createElement('span');
        title.className = 'group-title';
        title.textContent = groupTitle;

        const badges = document.createElement('div');
        badges.className = 'group-badges';

        header.appendChild(title);
        header.appendChild(badges);

        const testList = document.createElement('ul');
        testList.className = 'group-tests';

        header.addEventListener('click', () => {
            testList.style.display = testList.style.display === 'none' ? '' : 'none';
        });

        groupEl.appendChild(header);
        groupEl.appendChild(testList);
        groupsContainer.appendChild(groupEl);

        const entry = {element: groupEl, header, badges, testList, pass: 0, fail: 0};
        groups.set(groupTitle, entry);
        return entry;
    }

    function updateGroupBadges(group) {
        group.badges.innerHTML = '';
        if (group.pass > 0) {
            const b = document.createElement('span');
            b.className = 'badge pass';
            b.textContent = \`\${group.pass} passed\`;
            group.badges.appendChild(b);
        }
        if (group.fail > 0) {
            const b = document.createElement('span');
            b.className = 'badge fail';
            b.textContent = \`\${group.fail} failed\`;
            group.badges.appendChild(b);
        }
    }

    function formatError(err) {
        if (typeof err === 'string') return err;
        if (err && typeof err === 'object') return JSON.stringify(err, null, 2);
        return String(err);
    }

    function buildDiffElement(actual, expected) {
        const allKeys = Array.from(new Set([...Object.keys(actual), ...Object.keys(expected)]));
        const lines = [];

        for (const key of allKeys) {
            const hasA = Object.prototype.hasOwnProperty.call(actual, key);
            const hasE = Object.prototype.hasOwnProperty.call(expected, key);
            if (hasA && hasE) {
                const av = JSON.stringify(actual[key], null, 2);
                const ev = JSON.stringify(expected[key], null, 2);
                if (av === ev) {
                    lines.push({type: 'unchanged', text: \`  \${key}: \${av}\`});
                } else {
                    lines.push({type: 'removed', text: \`- \${key}: \${av}\`});
                    lines.push({type: 'added', text: \`+ \${key}: \${ev}\`});
                }
            } else if (hasA) {
                lines.push({type: 'removed', text: \`- \${key}: \${JSON.stringify(actual[key], null, 2)}\`});
            } else {
                lines.push({type: 'added', text: \`+ \${key}: \${JSON.stringify(expected[key], null, 2)}\`});
            }
        }

        const block = document.createElement('div');
        block.className = 'diff-block';

        const legend = document.createElement('div');
        legend.className = 'diff-legend';
        legend.innerHTML = '<span class="diff-legend-removed">- actual</span><span class="diff-legend-added">+ expected</span>';
        block.appendChild(legend);

        for (const {type, text} of lines) {
            const row = document.createElement('div');
            row.className = \`diff-line \${type}\`;
            row.textContent = text;
            block.appendChild(row);
        }

        return block;
    }

    function addTestResult(data) {
        const groupTitle = data.group?.title || 'Ungrouped';
        const group = getOrCreateGroup(groupTitle);

        const passed = !data.hasError;

        stats.total++;
        if (passed) {
            stats.pass++;
            group.pass++;
        } else {
            stats.fail++;
            group.fail++;
        }

        updateStats();
        updateGroupBadges(group);

        const li = document.createElement('li');
        li.className = 'test';
        li.dataset.failed = passed ? '0' : '1';

        const icon = document.createElement('span');
        icon.className = 'test-icon';
        icon.textContent = passed ? '✓' : '✗';
        icon.style.color = passed ? '#22c55e' : '#ef4444';

        const body = document.createElement('div');
        body.className = 'test-body';

        const titleEl = document.createElement('div');
        titleEl.className = 'test-title';
        titleEl.textContent = data.title;

        const filename = document.createElement('code');
        filename.className = 'test-filename';
        filename.textContent = data.file.name;
        filename.addEventListener('click', () => {
            navigator.clipboard.writeText(data.file.name);
        });

        const duration = document.createElement('div');
        duration.className = 'test-duration';
        duration.textContent = \`\${(data.duration || 0).toFixed(2)} ms\`;

        body.appendChild(titleEl);
        body.appendChild(filename);
        body.appendChild(duration);

        if (!passed && data.errors?.length) {
            const errorsEl = document.createElement('div');
            errorsEl.className = 'test-errors';
            for (const e of data.errors) {
                const errEl = document.createElement('div');
                errEl.className = 'test-error';
                const phase = document.createElement('div');
                phase.className = 'test-error-phase';
                phase.textContent = e.phase || 'error';
                errEl.appendChild(phase);
                if (e.error?.operator === 'deepStrictEqual') {
                    errEl.appendChild(buildDiffElement(e.error.actual, e.error.expected));
                } else {
                    errEl.appendChild(document.createTextNode(formatError(e.error)));
                }
                errorsEl.appendChild(errEl);
            }
            body.appendChild(errorsEl);
        }

        li.appendChild(icon);
        li.appendChild(body);
        group.testList.appendChild(li);
    }

    function sortResults() {
        for (const group of groups.values()) {
            const items = [...group.testList.children];
            items.sort((a, b) => b.dataset.failed - a.dataset.failed);
            for (const item of items) group.testList.appendChild(item);
        }
        const groupEls = [...groupsContainer.children].filter(el => el !== emptyState);
        groupEls.sort((a, b) => {
            const aEntry = [...groups.values()].find(g => g.element === a);
            const bEntry = [...groups.values()].find(g => g.element === b);
            return (bEntry?.fail ?? 0) - (aEntry?.fail ?? 0);
        });
        for (const el of groupEls) groupsContainer.appendChild(el);
        applyFilter();
    }

    document.addEventListener('DOMContentLoaded', () => {
        for (const result of RESULTS) {
            addTestResult(result);
        }
        sortResults();
        const failText = stats.fail > 0 ? \` — \${stats.fail} failed\` : '';
        document.getElementById('status-text').textContent =
            \`Generated: ${now} · \${stats.pass}/\${stats.total} passed\${failText}\`;
    });
</script>
</body>
</html>`
    }

    function generateReport(): string {
        const reportDir = path.join(process.cwd(), 'test_results')
        fs.mkdirSync(reportDir, {recursive: true})
        const reportPath = path.join(reportDir, 'report.html')
        generatedReportHtml = buildReportHtml(runState.results)
        fs.writeFileSync(reportPath, generatedReportHtml)
        console.log(`[REPORT] Generated at ${reportPath}`)
        return reportPath
    }

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
        } else if (req.url === '/report') {
            if (generatedReportHtml) {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(generatedReportHtml);
            } else {
                res.writeHead(404);
                res.end('Report not yet generated');
            }
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });


    // WebSocket server for real-time push to dashboard
    const wss = new WebSocketServer({server: httpServer});

    wss.on('listening', () => {
        state.websocket = true
        if (listeners && listeners.onReady) {
            listeners.onReady(state)
        }
    })

    wss.on('connection', (ws) => {
        console.log('[WS] Dashboard client connected');
        dashboardClients.add(ws);

        // Replay accumulated state for late-joining clients
        if (runState.started) {
            ws.send(JSON.stringify({type: 'run:start'}));
            for (const result of runState.results) {
                ws.send(JSON.stringify({type: 'test:result', data: result}));
            }
            if (runState.sorted) {
                ws.send(JSON.stringify({type: 'run:sort'}));
            }
            if (runState.ended) {
                ws.send(JSON.stringify({type: 'run:end'}));
            }
        }

        ws.on('close', () => {
            dashboardClients.delete(ws);
            console.log('[WS] Dashboard client disconnected');
        });
    });

    function broadcast(data: { type: string, data?: any, url?: string }) {
        const message = JSON.stringify(data);
        for (const client of dashboardClients) {
            if (client.readyState === 1) {
                client.send(message);
            }
        }
    }

    function ended() {
        runState.sorted = true;
        runState.ended = true;
        broadcast({type: 'run:sort'});
        broadcast({type: 'run:end'});

        // Generate static report
        const reportPath = generateReport()

        if (listeners.onReportReady) {
            listeners.onReportReady(reportPath)
        }
    }

    // TCP server to receive data from the custom reporter
    const tcpServer = net.createServer((socket) => {
        console.log(`[TCP] Reporter connected from ${socket.remoteAddress}`);

        // Notify dashboard that a new test run started
        runState.started = true;
        runState.results = [];
        runState.sorted = false;
        runState.ended = false;
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
                    runState.results = [];
                    runState.sorted = false;
                    runState.ended = false;
                    broadcast({type: 'run:start'});
                    continue;
                }
                if (trimmed === 'END') {
                    console.log('[TCP] END received — sorting failed tests first');
                    ended()
                    continue;
                }
                try {
                    const testResult = JSON.parse(trimmed);
                    console.log(`[TCP] Test result: ${testResult.title} — ${testResult.hasError ? 'FAIL' : 'PASS'}`);
                    runState.results.push(testResult);
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
                    runState.results.push(testResult);
                    broadcast({type: 'test:result', data: testResult});
                } catch {
                }
            }
            console.log('[TCP] Reporter disconnected');
            ended()
        });

        socket.on('error', (err) => {
            console.error('[TCP] Socket error:', err.message);
        });
    });

    tcpServer.on('listening', () => {
        state.tcp = true
        if (listeners && listeners.onReady) {
            listeners.onReady(state)
        }
    })

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
        stop,
        listeners
    }
}
